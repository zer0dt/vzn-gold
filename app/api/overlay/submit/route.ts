import { NextResponse } from 'next/server'
import { Transaction as SdkTransaction } from '@bsv/sdk'

import { submitBeefToOverlay } from '@/app/lib/overlay-submit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function POST(request: Request) {
  try {
    const { beef, topics } = (await request.json()) as { beef?: string; topics?: unknown }

    if (!beef || typeof beef !== 'string' || beef.trim().length === 0) {
      return NextResponse.json({ error: 'Missing beef' }, { status: 400 })
    }

    try {
      SdkTransaction.fromHexBEEF(beef)
    } catch {
      return NextResponse.json({ error: 'Invalid BEEF format' }, { status: 400 })
    }

    const result = await submitBeefToOverlay(beef, topics)
    if (!result.ok) {
      return NextResponse.json(
        {
          error: 'Overlay submit failed',
          txid: result.txid,
          topics: result.topics,
          overlay: result.overlay,
        },
        { status: result.status }
      )
    }

    return NextResponse.json(
      { txid: result.txid, topics: result.topics, overlay: result.overlay },
      { status: 201 }
    )
  } catch (error) {
    return NextResponse.json(
      { error: `overlay unreachable: ${errorMessage(error)}` },
      { status: 502 }
    )
  }
}
