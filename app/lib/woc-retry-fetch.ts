/**
 * WhatsOnChain rate-limits aggressively. Retry 429/503 with backoff (and Retry-After when present).
 */

const MAX_ATTEMPTS = 6
const BASE_DELAY_MS = 900

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function parseRetryAfterMs(response: Response): number | null {
  const raw = response.headers.get('retry-after')
  if (!raw) return null
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 60_000)
  }
  const when = Date.parse(raw)
  if (Number.isFinite(when)) {
    return Math.max(0, when - Date.now())
  }
  return null
}

function jitterMs(): number {
  return Math.floor(Math.random() * 400)
}

/**
 * Fetch a WOC URL; retries on 429 / 503 only. Other statuses (including 404) return immediately.
 */
export async function fetchWhatsOnChain(url: string, init?: RequestInit): Promise<Response> {
  let last: Response | undefined
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const response = await fetch(url, { ...init, cache: 'no-store' })
    last = response
    if (response.status !== 429 && response.status !== 503) {
      return response
    }
    if (attempt === MAX_ATTEMPTS) {
      return response
    }
    const fromHeader = parseRetryAfterMs(response)
    const backoff =
      fromHeader ?? BASE_DELAY_MS * 2 ** (attempt - 1) + jitterMs()
    await sleep(Math.min(backoff, 45_000))
  }
  return last!
}

export async function wocFetchText(url: string): Promise<string> {
  const response = await fetchWhatsOnChain(url)
  const body = await response.text()
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${body || response.statusText}`)
  }
  return body.trim()
}

export async function wocFetchJson<T>(url: string): Promise<T> {
  const response = await fetchWhatsOnChain(url)
  const body = await response.text()
  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${body || response.statusText}`)
  }
  return JSON.parse(body) as T
}
