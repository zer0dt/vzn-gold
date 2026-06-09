import { NextResponse } from 'next/server'

import { normalizeOverlayBaseUrl, overlayUpstreamHeaders } from '@/app/lib/overlay-url'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OVERLAY_URL = process.env.OVERLAY_URL ?? 'http://127.0.0.1:8080'

type OverlayBalanceResponse = {
  balance?: number
  utxoCount?: number
}

function normalizeBsv21OriginId(raw: string): string {
  const originId = raw.trim()
  if (!originId) return ''
  return originId.includes('_') ? originId : `${originId}_0`
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const address = searchParams.get('address')?.trim()
  const originIdParam = searchParams.get('originId')?.trim()
  const originIdEnv = process.env.NEXT_PUBLIC_LLM21_ORIGIN_ID?.trim()
  const originId = normalizeBsv21OriginId(originIdParam || originIdEnv || '')

  if (!address) {
    return NextResponse.json({ error: 'Missing address' }, { status: 400 })
  }

  if (!originId) {
    return NextResponse.json({ error: 'Missing originId' }, { status: 500 })
  }

  try {
    const upstreamUrl = `${normalizeOverlayBaseUrl(OVERLAY_URL)}/api/1sat/bsv21/${encodeURIComponent(
      originId
    )}/p2pkh/${encodeURIComponent(address)}/balance`

    const upstream = await fetch(upstreamUrl, {
      method: 'GET',
      cache: 'no-store',
      headers: overlayUpstreamHeaders(OVERLAY_URL, { accept: 'application/json' }),
    })

    const text = await upstream.text()
    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch {
      payload = { raw: text }
    }

    if (!upstream.ok) {
      return NextResponse.json(
        { error: 'Overlay balance lookup failed', status: upstream.status, overlay: payload },
        { status: upstream.status }
      )
    }

    const data = payload as OverlayBalanceResponse
    const balance = typeof data.balance === 'number' ? data.balance : 0
    const utxoCount = typeof data.utxoCount === 'number' ? data.utxoCount : 0

    return NextResponse.json({ balance, utxoCount, originId, address })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: `Overlay balance lookup unreachable: ${message}` }, { status: 502 })
  }
}

