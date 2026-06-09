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

export async function GET(request: Request) {
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

    await ensureArtifactLoaded()

    const topic = `tm_${originId}`
    const event = `id:${originId}`
    const upstream = await fetch(
      `${normalizeOverlayBaseUrl(OVERLAY_URL)}/api/1sat/events/${topic}/unspent?limit=1000`,
      {
        method: 'POST',
        headers: overlayUpstreamHeaders(OVERLAY_URL, { 'Content-Type': 'application/json' }),
        body: JSON.stringify([event]),
        cache: 'no-store',
      }
    )

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

    const candidates = payload
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

    const skipped: Array<{ txid: string; outputIndex: number; reason: string }> = []

    for (const candidate of candidates) {
      try {
        console.log(LOG_PREFIX, 'try candidate', {
          txid: candidate.txid,
          outputIndex: candidate.outputIndex,
          overlayAmt: candidate.amount.toString(),
        })
        const rawtx = await getRawTransactionHexForTxid(candidate.txid)
        const tx = new bsv.Transaction(rawtx)
        const output = tx.outputs[candidate.outputIndex]
        if (!output) {
          const entry = {
            txid: candidate.txid,
            outputIndex: candidate.outputIndex,
            reason: 'source transaction missing output',
          }
          skipped.push(entry)
          console.warn(LOG_PREFIX, 'skip', entry)
          continue
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
        })
        if (instance.supply <= BigInt(0)) {
          skipped.push({
            txid: candidate.txid,
            outputIndex: candidate.outputIndex,
            reason: 'decoded minter has no remaining supply',
          })
          console.warn(LOG_PREFIX, 'skip', skipped[skipped.length - 1])
          continue
        }

        console.log(LOG_PREFIX, 'selected minter', {
          txid: candidate.txid,
          outputIndex: candidate.outputIndex,
          supply: instance.supply.toString(),
          overlayAmt: candidate.amount.toString(),
          skippedBeforeSuccess: skipped.length,
        })

        return NextResponse.json({
          txid: candidate.txid,
          outputIndex: candidate.outputIndex,
          rawtx,
          satoshis: fromUTXO.satoshis,
          script: fromUTXO.script,
          supply: instance.supply.toString(),
          overlayAmount: candidate.amount.toString(),
          candidateCount: candidates.length,
          skipped,
        })
      } catch (error) {
        const entry = {
          txid: candidate.txid,
          outputIndex: candidate.outputIndex,
          reason: errorMessage(error),
        }
        skipped.push(entry)
        console.warn(LOG_PREFIX, 'candidate error', entry)
      }
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
