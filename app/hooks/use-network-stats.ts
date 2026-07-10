'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  fetchNetworkStats,
  getCachedNetworkStats,
  type NetworkStats,
} from '@/app/lib/network-stats-client'

export function useNetworkStats(options?: { enabled?: boolean; refreshOnMount?: boolean }) {
  const enabled = options?.enabled ?? true
  const refreshOnMount = options?.refreshOnMount ?? false

  const [data, setData] = useState<NetworkStats | null>(null)
  const [isLoading, setIsLoading] = useState(() => enabled)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false)
      return
    }

    let cancelled = false
    const cached = refreshOnMount ? null : getCachedNetworkStats()
    if (cached) {
      setData(cached)
      setIsLoading(false)
    } else {
      setIsLoading(true)
    }

    fetchNetworkStats({ refresh: refreshOnMount })
      .then((d) => {
        if (!cancelled) {
          setData(d)
          setError(null)
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e : new Error(String(e)))
          setData(null)
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [enabled, refreshOnMount])

  const refetch = useCallback(async (opts?: { refresh?: boolean; silent?: boolean }) => {
    if (!opts?.silent) {
      setIsLoading(true)
    }
    setError(null)
    try {
      const d = await fetchNetworkStats({ refresh: opts?.refresh === true })
      setData(d)
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)))
      if (!opts?.silent) {
        setData(null)
      }
    } finally {
      if (!opts?.silent) {
        setIsLoading(false)
      }
    }
  }, [])

  const applyMintedDelta = useCallback((amount: number) => {
    if (!Number.isFinite(amount) || amount <= 0) return

    setData((current) => {
      if (!current) return current
      const mintedTokens = Math.min(current.totalTokens, current.mintedTokens + amount)
      const remainingTokens = Math.max(current.totalTokens - mintedTokens, 0)
      return {
        ...current,
        mintedTokens,
        remainingTokens,
        mintedPercentage:
          current.totalTokens > 0
            ? Number(((mintedTokens / current.totalTokens) * 100).toFixed(4))
            : 0,
      }
    })
  }, [])

  return { data, isLoading, error, refetch, applyMintedDelta }
}
