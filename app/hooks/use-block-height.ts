import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BLOCK_HEIGHT_POLL_INTERVAL_MS } from '@/app/lib/block-height-poll'
import { useToast } from '@/app/hooks/use-toast'

// Module-level variable to track the last block we notified about
// This ensures only one toast per block across all hook instances
let lastNotifiedBlockHeight: number | null = null

const fetchBlockHeight = async () => {
  const response = await fetch('/api/block-height', { cache: 'no-store' })
  if (!response.ok) {
    console.error("Failed to fetch block height:", response.statusText);
    throw new Error('Failed to fetch block height');
  }
  const data = await response.json()
  return data.height || data.blocks || data.blockHeight || 0;
}

export function useBlockHeight(initialBlockHeight?: number) {
  const { toast } = useToast()
  const isFirstLoad = useRef(true)
  const hasLoggedInitial = useRef(false)

  const {
    data: blockHeight,
    error,
    isLoading
  } = useQuery({
    queryKey: ['blockHeight'],
    queryFn: fetchBlockHeight,
    refetchInterval: BLOCK_HEIGHT_POLL_INTERVAL_MS,
    // Match poll interval so focus/mount do not refetch WhatsOnChain more often than every 10s
    staleTime: BLOCK_HEIGHT_POLL_INTERVAL_MS,
    gcTime: 0, // Drop unused cache entries immediately
    refetchOnWindowFocus: true,
    refetchOnMount: 'always',
    refetchOnReconnect: true,
    initialData: initialBlockHeight, // Use initial data if provided
  })

  // Detect new blocks and notify user (only once per block globally)
  useEffect(() => {
    if (blockHeight) {
      // Skip toast on first load - only notify for actual new blocks
      if (isFirstLoad.current) {
        isFirstLoad.current = false
        if (!hasLoggedInitial.current) {
          console.log(
            '[useBlockHeight] initial block height:',
            blockHeight,
            'initialData prop:',
            initialBlockHeight ?? null
          )
          hasLoggedInitial.current = true
        }
        // Initialize the global tracker if not set
        if (lastNotifiedBlockHeight === null) {
          lastNotifiedBlockHeight = blockHeight
        }
        return
      }

      // Check if a new block was mined AND we haven't already notified about it
      if (lastNotifiedBlockHeight !== null && blockHeight > lastNotifiedBlockHeight) {
        toast({
          title: '⛏️ New Block Mined!',
          description: `Block #${blockHeight.toLocaleString()}`,
          duration: 3000,
        })
        // Update the global tracker so other instances don't show duplicate toasts
        lastNotifiedBlockHeight = blockHeight
      }
    }
  }, [blockHeight, toast])

  // Return the fetched height, falling back to initial if loading/error prevents fetch
  const currentBlockHeight = blockHeight ?? initialBlockHeight ?? 0;

  return {
    blockHeight: currentBlockHeight,
    error,
    isLoading: isLoading && blockHeight === undefined // Only loading if we don't have any data yet
  }
}