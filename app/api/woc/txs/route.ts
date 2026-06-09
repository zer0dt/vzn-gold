import { NextResponse } from 'next/server'

import { fetchWhatsOnChain } from '@/app/lib/woc-retry-fetch'

export async function POST(req: Request) {
  try {
    const { txids } = await req.json()
    if (!Array.isArray(txids) || txids.length === 0) {
      return NextResponse.json({ error: 'txids array required' }, { status: 400 })
    }
    const r = await fetchWhatsOnChain('https://api.whatsonchain.com/v1/bsv/main/txs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txids }),
    })
    if (!r.ok) {
      const text = await r.text()
      return NextResponse.json({ error: `WOC error: ${r.status} ${text}` }, { status: 502 })
    }
    const data = await r.json()
    return NextResponse.json(data, { status: 200 })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}


