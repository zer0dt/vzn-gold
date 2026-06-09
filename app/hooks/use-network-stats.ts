'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  fetchNetworkStats,
  getCachedNetworkStats,
  type NetworkStats,
} from '@/app/lib/network-stats-client'

export function useNetworkStats(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true

  const [data, setData] = useState<NetworkStats | null>(null)
  const [isLoading, setIsLoading] = useState(() => enabled)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false)
      return
    }

    let cancelled = false
    const cached = getCachedNetworkStats()
    if (cached) {
      setData(cached)
      setIsLoading(false)
    } else {
      setIsLoading(true)
    }

    fetchNetworkStats({ refresh: false })
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
  }, [enabled])

  const refetch = useCallback(async (opts?: { refresh?: boolean }) => {
    setIsLoading(true)
    setError(null)
    try {
      const d = await fetchNetworkStats({ refresh: opts?.refresh === true })
      setData(d)
    } catch (e) {
      setError(e instanceof Error ? e : new Error(String(e)))
      setData(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  return { data, isLoading, error, refetch }
}
