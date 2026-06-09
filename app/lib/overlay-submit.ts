import { Transaction as SdkTransaction } from '@bsv/sdk'

import { normalizeOverlayBaseUrl, overlayUpstreamHeaders } from '@/app/lib/overlay-url'

const OVERLAY_URL = process.env.OVERLAY_URL ?? 'http://localhost:3001'

export function normalizeOverlayTopics(topics: unknown, fallbackTopic: string): string[] {
  if (typeof topics === 'string' && topics.trim().length > 0) {
    return [topics.trim()]
  }

  if (Array.isArray(topics)) {
    const normalized = topics
      .filter((topic): topic is string => typeof topic === 'string')
      .map((topic) => topic.trim())
      .filter(Boolean)

    if (normalized.length > 0) {
      return normalized
    }
  }

  return [fallbackTopic]
}

export async function submitBeefToOverlay(
  beef: string,
  topics: unknown
): Promise<{
  txid: string
  topics: string[]
  overlay: unknown
  status: number
  ok: boolean
  elapsedMs: number
}> {
  const startedAt = Date.now()
  const txid = SdkTransaction.fromHexBEEF(beef).id('hex')
  const overlayTopics = normalizeOverlayTopics(topics, `tm_${txid}_0`)
  const upstream = await fetch(`${normalizeOverlayBaseUrl(OVERLAY_URL)}/api/v1/submit`, {
    method: 'POST',
    headers: overlayUpstreamHeaders(OVERLAY_URL, {
      'Content-Type': 'application/octet-stream',
      'x-topics': overlayTopics.join(','),
    }),
    body: Buffer.from(beef, 'hex'),
  })

  const text = await upstream.text()
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    payload = { raw: text }
  }

  return {
    txid,
    topics: overlayTopics,
    overlay: payload,
    status: upstream.status,
    ok: upstream.ok,
    elapsedMs: Date.now() - startedAt,
  }
}
