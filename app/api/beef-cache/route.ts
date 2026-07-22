import { NextResponse } from 'next/server'

import {
  buildCachedBeefFromRawTx,
  getCachedBeefByTxid,
  getLatestContractTipRawTx,
  prepareFundingParents,
  persistBroadcastTransaction,
  type PreparedFundingParent,
} from '@/app/lib/beef-cache'
import {
  broadcastBeefDirectToArc,
  DirectArcBroadcastError,
} from '@/app/lib/direct-arc-broadcast'
import {
  LockLikeSubmitError,
  persistLockLikeForCurrentUser,
  type SubmitLockLikeRequest,
} from '@/app/lib/lock-like-submit'
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
      overlayBsv21Parents,
      fundingParentTxids,
      fundingParents,
      overlayParentBeefBase64,
      responseFormat,
      submitOverlay,
      broadcastArc,
      topics,
      likeSubmit,
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
    const parsedOverlayBsv21Parents = Array.isArray(overlayBsv21Parents)
      ? overlayBsv21Parents
          .map((parent): { originId: string; txid: string } | null => {
            if (!parent || typeof parent !== 'object') return null
            const value = parent as Record<string, unknown>
            if (typeof value.originId !== 'string' || typeof value.txid !== 'string') return null
            const originId = value.originId.trim()
            const txid = value.txid.trim()
            if (!originId || !/^[0-9a-f]{64}$/i.test(txid)) return null
            return { originId, txid }
          })
          .filter((parent): parent is { originId: string; txid: string } => parent !== null)
          .slice(0, 250)
      : []
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
      overlayBsv21Parents: parsedOverlayBsv21Parents,
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
      const timings = {
        ...data.timings,
        buildBeefMs,
        overlaySubmitMs,
      }

      console.log('[beef-cache] built and submitted broadcast beef', {
        txid: submitResult.txid,
        overlayStatus: submitResult.status,
        overlayOk: submitResult.ok,
        topics: submitResult.topics,
        beefLength: data.beef.length,
        timings,
      })

      if (!submitResult.ok) {
        return NextResponse.json(
          {
            error: 'Overlay submit failed',
            txid: submitResult.txid,
            topics: submitResult.topics,
            overlay: submitResult.overlay,
            timings,
          },
          { status: submitResult.status }
        )
      }

      if (likeSubmit && typeof likeSubmit === 'object') {
        const tLikePersist0 = Date.now()
        try {
          const persistedLike = await persistLockLikeForCurrentUser({
            ...(likeSubmit as SubmitLockLikeRequest),
            txid: submitResult.txid,
            rawtx,
          })
          const likePersistMs = Date.now() - tLikePersist0

          return NextResponse.json(
            {
              txid: submitResult.txid,
              topics: submitResult.topics,
              overlay: submitResult.overlay,
              like: persistedLike.like,
              timings: {
                ...timings,
                likePersistMs,
              },
            },
            { status: persistedLike.status === 201 ? 201 : 200 }
          )
        } catch (error) {
          const likePersistMs = Date.now() - tLikePersist0
          const message = error instanceof Error ? error.message : 'Failed to persist like'
          const status = error instanceof LockLikeSubmitError ? error.status : 500
          return NextResponse.json(
            {
              error: message,
              txid: submitResult.txid,
              topics: submitResult.topics,
              overlay: submitResult.overlay,
              overlayAccepted: true,
              timings: {
                ...timings,
                likePersistMs,
              },
            },
            { status }
          )
        }
      }

      return NextResponse.json(
        {
          txid: submitResult.txid,
          topics: submitResult.topics,
          overlay: submitResult.overlay,
          timings,
        },
        { status: 201 }
      )
    }

    if (broadcastArc === true) {
      const tArc0 = Date.now()
      const broadcast = await broadcastBeefDirectToArc(data.beef)
      const arcBroadcastMs = Date.now() - tArc0
      const timings = {
        ...data.timings,
        buildBeefMs,
        arcBroadcastMs,
      }

      console.log('[beef-cache] built and broadcast direct to ARC', {
        txid: broadcast.txid,
        status: broadcast.status,
        beefLength: data.beef.length,
        timings,
      })

      return NextResponse.json(
        {
          ...broadcast,
          timings,
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
    if (error instanceof DirectArcBroadcastError) {
      return NextResponse.json(
        {
          error: error.message,
          details: error.details,
        },
        { status: error.status }
      )
    }
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
