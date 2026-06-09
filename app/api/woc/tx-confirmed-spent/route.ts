import { NextResponse } from 'next/server'

import { fetchWhatsOnChain } from '@/app/lib/woc-retry-fetch'

const WOC_MAIN = 'https://api.whatsonchain.com/v1/bsv/main'

function normalizeTxid(t: string): string {
  return t.trim().toLowerCase()
}

/** Proxies WOC GET …/tx/<txid>/<vout>/confirmed/spent. WOC 404 = output not spent (confirmed). */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const txid = searchParams.get('txid')?.trim()
    const voutParam = searchParams.get('vout')
    if (!txid || !/^[0-9a-f]{64}$/i.test(txid)) {
      return NextResponse.json({ error: 'Valid txid required' }, { status: 400 })
    }
    const vout = voutParam === null || voutParam === '' ? NaN : Number(voutParam)
    if (!Number.isInteger(vout) || vout < 0) {
      return NextResponse.json({ error: 'Valid vout required' }, { status: 400 })
    }

    const r = await fetchWhatsOnChain(
      `${WOC_MAIN}/tx/${normalizeTxid(txid)}/${vout}/confirmed/spent`
    )

    if (r.status === 404) {
      return NextResponse.json({ unspent: true, spendingTxid: null }, { status: 200 })
    }

    if (!r.ok) {
      const text = await r.text()
      return NextResponse.json({ error: `WOC ${r.status}: ${text.slice(0, 200)}` }, { status: 502 })
    }

    const data = (await r.json()) as { txid?: string; vin?: number; status?: string }
    const spendingTxid =
      typeof data.txid === 'string' && /^[0-9a-f]{64}$/i.test(data.txid)
        ? normalizeTxid(data.txid)
        : null

    return NextResponse.json({
      unspent: false,
      spendingTxid,
      vin: typeof data.vin === 'number' ? data.vin : undefined,
      status: typeof data.status === 'string' ? data.status : undefined,
    })
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
