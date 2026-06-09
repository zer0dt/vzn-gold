import { tokenTickerBase } from '@/app/lib/formatTokenTicker'

export type NetworkStats = {
  symbol: string
  /** Tokens minted per lock from deploy inscription `lim` (e.g. BSV-20 json). */
  mintLimit: number
  mintedTokens: number
  totalTokens: number
  mintedPercentage: number
  remainingTokens: number
}

const TTL_MS = 60_000

let cache: { data: NetworkStats; fetchedAt: number } | null = null

/** Synchronous read of fresh cached stats (same TTL as fetchNetworkStats). */
export function getCachedNetworkStats(): NetworkStats | null {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache.data
  return null
}
let inflightNormal: Promise<NetworkStats> | null = null
let inflightRefresh: Promise<NetworkStats> | null = null

function coerceNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

function coercePositiveInt(value: unknown, fallback: number): number {
  const n = coerceNumber(value, NaN)
  if (Number.isFinite(n) && n > 0) return Math.floor(n)
  return fallback
}

export function parseNetworkStatsPayload(json: unknown): NetworkStats {
  const o = json && typeof json === 'object' ? (json as Record<string, unknown>) : {}
  const sym = typeof o.symbol === 'string' ? o.symbol : ''
  return {
    symbol: tokenTickerBase(sym),
    mintLimit: coercePositiveInt(o.mintLimit, 1000),
    mintedTokens: coerceNumber(o.mintedTokens, 0),
    totalTokens: coerceNumber(o.totalTokens, 0),
    mintedPercentage: coerceNumber(o.mintedPercentage, 0),
    remainingTokens: coerceNumber(o.remainingTokens, 0),
  }
}

async function fetchFromApi(refresh: boolean): Promise<NetworkStats> {
  const query = refresh ? '?refresh=1' : ''
  const res = await fetch(`/api/network-stats${query}`, {
    cache: refresh ? 'no-store' : 'default',
  })
  if (!res.ok) {
    throw new Error(`Network stats request failed: ${res.status} ${res.statusText}`)
  }
  const json: unknown = await res.json()
  return parseNetworkStatsPayload(json)
}

/**
 * Dedupes in-flight requests; caches successful normal fetches for TTL_MS.
 * Refresh bypasses cache but updates the normal cache when complete.
 */
export async function fetchNetworkStats(options?: {
  refresh?: boolean
}): Promise<NetworkStats> {
  const refresh = options?.refresh === true

  if (refresh) {
    if (inflightRefresh) return inflightRefresh
    inflightRefresh = (async () => {
      try {
        const data = await fetchFromApi(true)
        cache = { data, fetchedAt: Date.now() }
        return data
      } finally {
        inflightRefresh = null
      }
    })()
    return inflightRefresh
  }

  if (cache && Date.now() - cache.fetchedAt < TTL_MS) {
    return cache.data
  }

  if (inflightNormal) return inflightNormal

  inflightNormal = (async () => {
    try {
      const data = await fetchFromApi(false)
      cache = { data, fetchedAt: Date.now() }
      return data
    } finally {
      inflightNormal = null
    }
  })()

  return inflightNormal
}
