import { NextResponse } from 'next/server'

import { normalizeOverlayBaseUrl, overlayUpstreamHeaders } from '@/app/lib/overlay-url'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OVERLAY_URL = process.env.OVERLAY_URL ?? 'http://localhost:8080'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function GET() {
  try {
    const upstream = await fetch(`${normalizeOverlayBaseUrl(OVERLAY_URL)}/llm21/stats`, {
      cache: 'no-store',
      headers: overlayUpstreamHeaders(OVERLAY_URL),
    })
    const payload = await upstream.json()
    return NextResponse.json(payload, { status: upstream.status })
  } catch (error) {
    return NextResponse.json(
      { error: `overlay unreachable: ${errorMessage(error)}` },
      { status: 502 }
    )
  }
}
