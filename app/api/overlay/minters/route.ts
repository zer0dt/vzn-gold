import { NextResponse } from 'next/server'
import { bsv } from 'scrypt-ts'

import parallelArtifact from '@/artifacts/LockLikeMintBSV21Parallel.json'
import { getRawTransactionHexForTxid } from '@/app/lib/beef-cache'
import { isBsv21MinterPoolOp } from '@/app/lib/bsv21-minter-pool'
import { normalizeOverlayBaseUrl, overlayUpstreamHeaders } from '@/app/lib/overlay-url'
import { LockLikeMintBSV21Parallel } from '@/src/contracts/LockLikeMintBSV21Parallel'

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

let artifactLoadPromise: Promise<unknown> | null = null

function ensureArtifactLoaded(): Promise<unknown> {
  if (!artifactLoadPromise) {
    artifactLoadPromise = Promise.resolve(
      LockLikeMintBSV21Parallel.loadArtifact(parallelArtifact as any)
    )
  }

  return artifactLoadPromise
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
const CANDIDATE_VALIDATION_CONCURRENCY = 4

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

    const fromUTXO = {
      txId: candidate.txid,
      outputIndex: candidate.outputIndex,
      satoshis: output.satoshis,
      script: output.script.toHex(),
    }
    const instance = LockLikeMintBSV21Parallel.fromUTXO(fromUTXO)
    console.log(LOG_PREFIX, 'decoded contract', {
      txid: candidate.txid,
      outputIndex: candidate.outputIndex,
      supply: instance.supply.toString(),
      overlayAmt: candidate.amount.toString(),
      index,
    })
    if (instance.supply <= BigInt(0)) {
      const skipped = {
        txid: candidate.txid,
        outputIndex: candidate.outputIndex,
        reason: 'decoded minter has no remaining supply',
      }
      console.warn(LOG_PREFIX, 'skip', skipped)
      return { ok: false, index, skipped, elapsedMs: Date.now() - startedAt }
    }

    return {
      ok: true,
      index,
      candidate,
      rawtx,
      satoshis: fromUTXO.satoshis,
      script: fromUTXO.script,
      supply: instance.supply.toString(),
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

export async function GET(request: Request) {
  const startedAt = Date.now()
  const { searchParams } = new URL(request.url)
  const originId = searchParams.get('originId')?.trim()
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
      excludeCount: excluded.size,
      overlayBase: normalizeOverlayBaseUrl(OVERLAY_URL),
    })

    const artifactStartedAt = Date.now()
    await ensureArtifactLoaded()
    const artifactMs = Date.now() - artifactStartedAt

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

    for (let offset = 0; offset < candidates.length; offset += CANDIDATE_VALIDATION_CONCURRENCY) {
      const batch = candidates.slice(offset, offset + CANDIDATE_VALIDATION_CONCURRENCY)
      const results = await Promise.all(
        batch.map((candidate, batchIndex) => validateCandidate(candidate, offset + batchIndex))
      )
      const selected = results.find((result): result is Extract<CandidateValidationResult, { ok: true }> => result.ok)
      if (!selected) {
        skipped.push(
          ...results
            .filter((result): result is Extract<CandidateValidationResult, { ok: false }> => !result.ok)
            .map((result) => result.skipped)
        )
        continue
      }

      skipped.push(
        ...results
          .filter(
            (result): result is Extract<CandidateValidationResult, { ok: false }> =>
              !result.ok && result.index < selected.index
          )
          .map((result) => result.skipped)
      )

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
          artifactMs,
          overlayUnspentMs,
          validationMs,
          selectedCandidateMs: selected.elapsedMs,
          elapsedMs: Date.now() - startedAt,
          validationConcurrency: CANDIDATE_VALIDATION_CONCURRENCY,
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
          artifactMs,
          overlayUnspentMs,
          validationMs: Date.now() - validationStartedAt,
          elapsedMs: Date.now() - startedAt,
          validationConcurrency: CANDIDATE_VALIDATION_CONCURRENCY,
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
