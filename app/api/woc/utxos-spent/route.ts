import { NextResponse } from 'next/server'

import { fetchWhatsOnChain } from '@/app/lib/woc-retry-fetch'

type UtxoRef = {
  txid: string
  vout: number
}

export async function POST(req: Request) {
  try {
    const { utxos } = await req.json()

    if (!Array.isArray(utxos) || utxos.length === 0) {
      return NextResponse.json({ error: 'utxos array required' }, { status: 400 })
    }

    const normalizedUtxos = utxos.filter((utxo): utxo is UtxoRef => {
      return (
        !!utxo &&
        typeof utxo === 'object' &&
        typeof (utxo as UtxoRef).txid === 'string' &&
        typeof (utxo as UtxoRef).vout === 'number'
      )
    })

    if (normalizedUtxos.length === 0) {
      return NextResponse.json({ error: 'No valid utxos provided' }, { status: 400 })
    }

    const r = await fetchWhatsOnChain('https://api.whatsonchain.com/v1/bsv/main/utxos/spent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ utxos: normalizedUtxos }),
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
