import { NextResponse } from 'next/server'

import { getLatestContractTip } from '@/app/lib/beef-cache'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const originIdOverride = searchParams.get('originId')?.trim()
    const originId = originIdOverride || process.env.NEXT_PUBLIC_LLM21_ORIGIN_ID?.trim()

    if (!originId) {
      return NextResponse.json(
        { error: 'LLM-21 origin not configured' },
        { status: 500 }
      )
    }

    const { txid, outputIndex } = await getLatestContractTip(originId)

    return NextResponse.json({
      txid,
      outputIndex,
      originId,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
