import { NextResponse } from 'next/server'

import { prefetchOverlayBsv21ParentBeefBase64 } from '@/app/lib/beef-cache'

export const dynamic = 'force-dynamic'

/**
 * Warms server-side overlay BSV21 tx BEEF cache in parallel with mint build.
 * The client gets metadata only so it does not need to shuttle multi-MB BEEF back to /api/beef-cache.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const originId = searchParams.get('originId')?.trim()
    const txid = searchParams.get('txid')?.trim()

    if (!originId || !txid) {
      return NextResponse.json({ error: 'Missing originId or txid' }, { status: 400 })
    }

    const data = await prefetchOverlayBsv21ParentBeefBase64({ originId, txid })
    return NextResponse.json({
      prefetched: Boolean(data.beefBase64),
      beefBase64Chars: data.beefBase64?.length ?? 0,
      elapsedMs: data.elapsedMs,
      source: data.source,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message, prefetched: false }, { status: 500 })
  }
}
