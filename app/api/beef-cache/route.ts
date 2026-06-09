import { NextResponse } from 'next/server'

import {
  buildCachedBeefFromRawTx,
  getCachedBeefByTxid,
  getLatestContractTipRawTx,
  prepareFundingParents,
  persistBroadcastTransaction,
  type PreparedFundingParent,
} from '@/app/lib/beef-cache'
import { submitBeefToOverlay } from '@/app/lib/overlay-submit'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const txid = searchParams.get('txid')?.trim()
    const originId = searchParams.get('originId')?.trim()

    if (!txid && !originId) {
      return NextResponse.json({ error: 'Missing txid or originId' }, { status: 400 })
    }

    if (txid && originId) {
      return NextResponse.json({ error: 'Provide either txid or originId, not both' }, { status: 400 })
    }

    if (originId) {
      const data = await getLatestContractTipRawTx(originId)
      return NextResponse.json(data)
    }

    const data = await getCachedBeefByTxid(txid as string)
    return NextResponse.json(data)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const {
      rawtx,
      knownTxids,
      originId,
      selectedMinterTxid,
      contractInputTxid,
      fundingParentTxids,
      fundingParents,
      overlayParentBeefBase64,
      responseFormat,
      submitOverlay,
      topics,
    } = await request.json()

    if (!rawtx && Array.isArray(fundingParentTxids)) {
      const parsedFundingParentTxids = fundingParentTxids
        .filter((txid): txid is string => typeof txid === 'string')
        .map((txid) => txid.trim())
        .filter((txid) => txid.length > 0)
      const data = await prepareFundingParents(parsedFundingParentTxids)
      return NextResponse.json(data)
    }

    if (!rawtx || typeof rawtx !== 'string') {
      return NextResponse.json({ error: 'Missing rawtx' }, { status: 400 })
    }

    const parsedKnownTxids = Array.isArray(knownTxids)
      ? knownTxids
          .filter((txid): txid is string => typeof txid === 'string')
          .map((txid) => txid.trim())
          .filter((txid) => txid.length > 0)
      : []
    const overlayBsv21Parent =
      typeof originId === 'string' &&
      (typeof selectedMinterTxid === 'string' || typeof contractInputTxid === 'string')
        ? {
            originId: originId.trim(),
            txid:
              typeof selectedMinterTxid === 'string'
                ? selectedMinterTxid.trim()
                : contractInputTxid.trim(),
          }
        : undefined
    const parsedFundingParents: PreparedFundingParent[] = Array.isArray(fundingParents)
      ? fundingParents
          .map((parent): PreparedFundingParent | null => {
            if (!parent || typeof parent !== 'object') return null
            const value = parent as Record<string, unknown>
            if (typeof value.txid !== 'string' || typeof value.rawtx !== 'string') return null
            return {
              txid: value.txid.trim(),
              rawtx: value.rawtx.trim(),
              merklePathHex:
                typeof value.merklePathHex === 'string'
                  ? value.merklePathHex.trim()
                  : null,
            }
          })
          .filter((parent): parent is PreparedFundingParent => parent !== null)
      : []

    const parsedOverlayParentBeefBase64 =
      typeof overlayParentBeefBase64 === 'string' ? overlayParentBeefBase64.trim() : undefined

    const tBuild0 = Date.now()
    const data = await buildCachedBeefFromRawTx(rawtx, {
      knownTxids: parsedKnownTxids,
      overlayBsv21Parent,
      overlayParentBeefBase64: parsedOverlayParentBeefBase64,
      fundingParents: parsedFundingParents,
    })
    const buildBeefMs = Date.now() - tBuild0

    if (submitOverlay === true) {
      const overlayTopic =
        typeof originId === 'string' && originId.trim().length > 0 ? `tm_${originId.trim()}` : undefined
      const tSubmit0 = Date.now()
      const submitResult = await submitBeefToOverlay(data.beef, topics ?? overlayTopic)
      const overlaySubmitMs = Date.now() - tSubmit0

      console.log('[beef-cache] built and submitted broadcast beef', {
        txid: submitResult.txid,
        overlayStatus: submitResult.status,
        overlayOk: submitResult.ok,
        topics: submitResult.topics,
        beefLength: data.beef.length,
        buildBeefMs,
        overlaySubmitMs,
      })

      if (!submitResult.ok) {
        return NextResponse.json(
          {
            error: 'Overlay submit failed',
            txid: submitResult.txid,
            topics: submitResult.topics,
            overlay: submitResult.overlay,
            timings: {
              buildBeefMs,
              overlaySubmitMs,
            },
          },
          { status: submitResult.status }
        )
      }

      return NextResponse.json(
        {
          txid: submitResult.txid,
          topics: submitResult.topics,
          overlay: submitResult.overlay,
          timings: {
            buildBeefMs,
            overlaySubmitMs,
          },
        },
        { status: 201 }
      )
    }

    if (responseFormat === 'text' || request.headers.get('accept')?.includes('text/plain')) {
      return new Response(data.beef, {
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'text/plain; charset=utf-8',
        },
      })
    }

    return NextResponse.json(data)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PUT(request: Request) {
  try {
    const { txid, rawtx } = await request.json()

    if (!txid || typeof txid !== 'string') {
      return NextResponse.json({ error: 'Missing txid' }, { status: 400 })
    }

    if (!rawtx || typeof rawtx !== 'string') {
      return NextResponse.json({ error: 'Missing rawtx' }, { status: 400 })
    }

    await persistBroadcastTransaction({
      txid,
      rawtx,
    })

    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
