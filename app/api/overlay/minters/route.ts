import { NextResponse } from 'next/server'
import { bsv } from 'scrypt-ts'

import { getRawTransactionHexForTxid } from '@/app/lib/beef-cache'
import { isBsv21MinterPoolOp } from '@/app/lib/bsv21-minter-pool'
import { normalizeOverlayBaseUrl, overlayUpstreamHeaders } from '@/app/lib/overlay-url'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OVERLAY_URL = process.env.OVERLAY_URL ?? 'http://127.0.0.1:8080'

type OverlayOutputData = {
  txid?: string
  vout?: number
  outputIndex?: number
  outpoint?: string
  satoshis?: number
  data?: {
    bsv21?: {
      address?: string
      amt?: string
      op?: string
      id?: string
    }
  }
}

function overlayOutpoint(output: OverlayOutputData): { txid: string; outputIndex: number } | null {
  if (output.txid && typeof output.vout === 'number') {
    return { txid: output.txid, outputIndex: output.vout }
  }

  if (output.txid && typeof output.outputIndex === 'number') {
    return { txid: output.txid, outputIndex: output.outputIndex }
  }

  if (output.outpoint) {
    const separator = output.outpoint.includes('_') ? '_' : '.'
    const [txid, outputIndexText] = output.outpoint.split(separator)
    const outputIndex = Number(outputIndexText)
    if (txid && Number.isInteger(outputIndex) && outputIndex >= 0) {
      return { txid, outputIndex }
    }
  }

  return null
}

function parseBsv21Amount(output: OverlayOutputData): bigint {
  const amt = output.data?.bsv21?.amt
  if (amt !== undefined && /^[0-9]+$/.test(amt)) {
    return BigInt(amt)
  }

  return BigInt(0)
}

function isCandidateMinterOutput(
  output: OverlayOutputData,
  originId: string
): output is OverlayOutputData & { data: { bsv21: { amt: string; op: string; id: string } } } {
  const outpoint = overlayOutpoint(output)
  const bsv21 = output.data?.bsv21
  if (!bsv21) return false

  return (
    outpoint !== null &&
    (outpoint.outputIndex === 0 || outpoint.outputIndex === 1) &&
    isBsv21MinterPoolOp(bsv21.op) &&
    bsv21.id === originId &&
    typeof bsv21.amt === 'string' &&
    /^[0-9]+$/.test(bsv21.amt) &&
    !bsv21.address // payee transfer — not an unspent pool/minter branch we can spend as minter
  )
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const LOG_PREFIX = '[overlay/minters]'
/** Used by `?all=true` bulk validation. */
const CANDIDATE_VALIDATION_CONCURRENCY = 4
/**
 * Selection trusts overlay amount ranking (largest first), so only walk
 * candidates until the first success. Concurrency 1 avoids wasting rawtx
 * fetches on smaller tips while the largest is still in flight.
 */
const MINTER_SELECT_CONCURRENCY = 1

type MinterCandidate = {
  txid: string
  outputIndex: number
  amount: bigint
}

type CandidateSkip = {
  txid: string
  outputIndex: number
  reason: string
}

type CandidateValidationResult =
  | {
      ok: true
      index: number
      candidate: MinterCandidate
      rawtx: string
      satoshis: number
      script: string
      supply: string
      elapsedMs: number
    }
  | {
      ok: false
      index: number
      skipped: CandidateSkip
      elapsedMs: number
    }

function summarizeUnspentRows(payload: unknown[], originId: string, limit = 40) {
  const slice = payload.slice(0, limit)
  const rows = slice.map((raw) => {
    const o = raw as OverlayOutputData
    const b = o.data?.bsv21
    const out = overlayOutpoint(o)
    return {
      txid: o.txid,
      vout: o.vout ?? o.outputIndex,
      op: b?.op,
      amt: b?.amt,
      idMatch: b?.id === originId,
      hasAddress: Boolean(b?.address),
      outpoint: out ? `${out.txid.slice(0, 10)}…:${out.outputIndex}` : null,
      passesCandidateFilter: isCandidateMinterOutput(o, originId),
    }
  })
  return { rows, total: payload.length, truncated: payload.length > limit }
}

/**
 * Light validation: trust overlay `amt` for supply ranking/selection.
 * Only fetch rawtx + confirm the output exists. Full contract decode happens
 * client-side when building the mint unlock.
 */
async function validateCandidate(
  candidate: MinterCandidate,
  index: number
): Promise<CandidateValidationResult> {
  const startedAt = Date.now()
  try {
    console.log(LOG_PREFIX, 'try candidate', {
      txid: candidate.txid,
      outputIndex: candidate.outputIndex,
      overlayAmt: candidate.amount.toString(),
      index,
    })

    if (candidate.amount <= BigInt(0)) {
      const skipped = {
        txid: candidate.txid,
        outputIndex: candidate.outputIndex,
        reason: 'overlay amount is zero',
      }
      console.warn(LOG_PREFIX, 'skip', skipped)
      return { ok: false, index, skipped, elapsedMs: Date.now() - startedAt }
    }

    const rawtx = await getRawTransactionHexForTxid(candidate.txid)
    const tx = new bsv.Transaction(rawtx)
    const output = tx.outputs[candidate.outputIndex]
    if (!output) {
      const skipped = {
        txid: candidate.txid,
        outputIndex: candidate.outputIndex,
        reason: 'source transaction missing output',
      }
      console.warn(LOG_PREFIX, 'skip', skipped)
      return { ok: false, index, skipped, elapsedMs: Date.now() - startedAt }
    }

    const supply = candidate.amount.toString()
    console.log(LOG_PREFIX, 'accepted candidate', {
      txid: candidate.txid,
      outputIndex: candidate.outputIndex,
      supply,
      overlayAmt: supply,
      index,
      elapsedMs: Date.now() - startedAt,
    })

    return {
      ok: true,
      index,
      candidate,
      rawtx,
      satoshis: output.satoshis,
      script: output.script.toHex(),
      supply,
      elapsedMs: Date.now() - startedAt,
    }
  } catch (error) {
    const skipped = {
      txid: candidate.txid,
      outputIndex: candidate.outputIndex,
      reason: errorMessage(error),
    }
    console.warn(LOG_PREFIX, 'candidate error', skipped)
    return { ok: false, index, skipped, elapsedMs: Date.now() - startedAt }
  }
}

/**
 * Candidates are pre-sorted largest overlay amount first.
 * Validate with bounded concurrency, but return as soon as the best-ranked
 * success is known — do not wait for worse-ranked in-flight work.
 */
async function selectLargestValidMinter(candidates: MinterCandidate[]): Promise<{
  selected: Extract<CandidateValidationResult, { ok: true }> | null
  skipped: CandidateSkip[]
}> {
  const skipped: CandidateSkip[] = []
  if (candidates.length === 0) {
    return { selected: null, skipped }
  }

  const results: Array<CandidateValidationResult | undefined> = Array.from({
    length: candidates.length,
  })
  const inFlight = new Map<number, Promise<void>>()
  let nextIndex = 0
  let resolvedUpTo = 0

  const launch = (index: number) => {
    const promise = validateCandidate(candidates[index], index)
      .then((result) => {
        results[index] = result
      })
      .finally(() => {
        inFlight.delete(index)
      })
    inFlight.set(index, promise)
  }

  while (resolvedUpTo < candidates.length) {
    while (
      inFlight.size < MINTER_SELECT_CONCURRENCY &&
      nextIndex < candidates.length
    ) {
      launch(nextIndex)
      nextIndex += 1
    }

    if (inFlight.size === 0) {
      break
    }

    await Promise.race(inFlight.values())

    while (resolvedUpTo < candidates.length && results[resolvedUpTo]) {
      const result = results[resolvedUpTo]
      if (!result) break

      if (result.ok) {
        return { selected: result, skipped }
      }

      skipped.push(result.skipped)
      resolvedUpTo += 1
    }
  }

  return { selected: null, skipped }
}

export async function GET(request: Request) {
  const startedAt = Date.now()
  const { searchParams } = new URL(request.url)
  const originId =
    searchParams.get('originId')?.trim() || process.env.NEXT_PUBLIC_LLM21_ORIGIN_ID?.trim()
  const returnAll = searchParams.get('all') === 'true'
  const excluded = new Set(
    searchParams
      .getAll('exclude')
      .flatMap((value) => value.split(','))
      .map((value) => value.trim())
      .filter(Boolean)
  )

  if (!originId) {
    return NextResponse.json({ error: 'Missing originId' }, { status: 400 })
  }

  try {
    console.log(LOG_PREFIX, 'GET', {
      originId,
      returnAll,
      excludeCount: excluded.size,
      overlayBase: normalizeOverlayBaseUrl(OVERLAY_URL),
    })

    const topic = `tm_${originId}`
    const event = `id:${originId}`
    const overlayStartedAt = Date.now()
    const upstream = await fetch(
      `${normalizeOverlayBaseUrl(OVERLAY_URL)}/api/1sat/events/${topic}/unspent?limit=1000`,
      {
        method: 'POST',
        headers: overlayUpstreamHeaders(OVERLAY_URL, { 'Content-Type': 'application/json' }),
        body: JSON.stringify([event]),
        cache: 'no-store',
      }
    )
    const overlayUnspentMs = Date.now() - overlayStartedAt

    const text = await upstream.text()
    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch {
      payload = { raw: text }
    }

    if (!upstream.ok) {
      console.warn(LOG_PREFIX, 'overlay HTTP error', {
        status: upstream.status,
        statusText: upstream.statusText,
        topic,
        payloadPreview:
          typeof payload === 'object' && payload !== null
            ? JSON.stringify(payload).slice(0, 500)
            : String(text).slice(0, 500),
      })
      return NextResponse.json(
        {
          error: 'Overlay minter lookup failed',
          status: upstream.status,
          overlay: payload,
        },
        { status: upstream.status }
      )
    }

    if (!Array.isArray(payload)) {
      console.warn(LOG_PREFIX, 'overlay response not an array', {
        type: typeof payload,
        preview: JSON.stringify(payload).slice(0, 400),
      })
      return NextResponse.json(
        { error: 'Overlay minter lookup returned an unexpected response', overlay: payload },
        { status: 502 }
      )
    }

    const unspentSummary = summarizeUnspentRows(payload, originId)
    console.log(LOG_PREFIX, 'overlay unspent', {
      count: unspentSummary.total,
      truncatedSummary: unspentSummary.truncated,
      rows: unspentSummary.rows,
    })

    const candidates: MinterCandidate[] = payload
      .map((output) => {
        const overlayOutput = output as OverlayOutputData
        if (!isCandidateMinterOutput(overlayOutput, originId)) {
          return null
        }

        const outpoint = overlayOutpoint(overlayOutput)
        return outpoint
          ? {
              ...outpoint,
              amount: parseBsv21Amount(overlayOutput),
            }
          : null
      })
      .filter(
        (candidate): candidate is { txid: string; outputIndex: number; amount: bigint } => {
          return candidate !== null && !excluded.has(`${candidate.txid}:${candidate.outputIndex}`)
        }
      )
      .sort((a, b) => {
        if (a.amount === b.amount) return 0
        return a.amount > b.amount ? -1 : 1
      })

    console.log(LOG_PREFIX, 'candidates after filter', {
      count: candidates.length,
      outpoints: candidates.map((c) => `${c.txid}:${c.outputIndex}`),
      overlayAmounts: candidates.map((c) => c.amount.toString()),
      excluded: [...excluded],
    })

    const skipped: CandidateSkip[] = []
    const validationStartedAt = Date.now()

    if (returnAll) {
      const minters: Array<{
        txid: string
        outputIndex: number
        satoshis: number
        supply: string
        overlayAmount: string
      }> = []

      for (
        let offset = 0;
        offset < candidates.length;
        offset += CANDIDATE_VALIDATION_CONCURRENCY
      ) {
        const batch = candidates.slice(offset, offset + CANDIDATE_VALIDATION_CONCURRENCY)
        const results = await Promise.all(
          batch.map((candidate, batchIndex) => validateCandidate(candidate, offset + batchIndex))
        )

        for (const result of results) {
          if (result.ok) {
            minters.push({
              txid: result.candidate.txid,
              outputIndex: result.candidate.outputIndex,
              satoshis: result.satoshis,
              supply: result.supply,
              overlayAmount: result.candidate.amount.toString(),
            })
          } else {
            skipped.push(result.skipped)
          }
        }
      }

      const validationMs = Date.now() - validationStartedAt
      console.log(LOG_PREFIX, 'validated all minters', {
        originId,
        candidateCount: candidates.length,
        minterCount: minters.length,
        skippedCount: skipped.length,
        validationMs,
        elapsedMs: Date.now() - startedAt,
      })

      return NextResponse.json({
        originId,
        minters,
        minterCount: minters.length,
        candidateCount: candidates.length,
        skipped,
        timings: {
          overlayUnspentMs,
          validationMs,
          elapsedMs: Date.now() - startedAt,
          validationConcurrency: CANDIDATE_VALIDATION_CONCURRENCY,
        },
      })
    }

    const { selected, skipped: skippedBeforeSuccess } = await selectLargestValidMinter(candidates)
    skipped.push(...skippedBeforeSuccess)

    if (selected) {
      const validationMs = Date.now() - validationStartedAt
      console.log(LOG_PREFIX, 'selected minter', {
        txid: selected.candidate.txid,
        outputIndex: selected.candidate.outputIndex,
        supply: selected.supply,
        overlayAmt: selected.candidate.amount.toString(),
        skippedBeforeSuccess: skipped.length,
        selectedIndex: selected.index,
        validationMs,
        elapsedMs: Date.now() - startedAt,
      })

      return NextResponse.json({
        txid: selected.candidate.txid,
        outputIndex: selected.candidate.outputIndex,
        rawtx: selected.rawtx,
        satoshis: selected.satoshis,
        script: selected.script,
        supply: selected.supply,
        overlayAmount: selected.candidate.amount.toString(),
        candidateCount: candidates.length,
        skipped,
        timings: {
          overlayUnspentMs,
          validationMs,
          selectedCandidateMs: selected.elapsedMs,
          elapsedMs: Date.now() - startedAt,
          validationConcurrency: MINTER_SELECT_CONCURRENCY,
        },
      })
    }

    console.warn(LOG_PREFIX, 'no live minter — returning 404', {
      originId,
      candidateCount: candidates.length,
      skipped,
    })

    return NextResponse.json(
      {
        error: 'Overlay returned no live LockLikeMintBSV21Parallel minters',
        candidateCount: candidates.length,
        skipped,
        timings: {
          overlayUnspentMs,
          validationMs: Date.now() - validationStartedAt,
          elapsedMs: Date.now() - startedAt,
          validationConcurrency: MINTER_SELECT_CONCURRENCY,
        },
      },
      { status: 404 }
    )
  } catch (error) {
    console.error(LOG_PREFIX, 'unhandled', errorMessage(error))
    return NextResponse.json(
      { error: `overlay minter lookup unreachable: ${errorMessage(error)}` },
      { status: 502 }
    )
  }
}
