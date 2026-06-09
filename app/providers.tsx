'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { cleanupOldPasskeyTestData, installTempPasswordLifecycleGuards } from '@/app/lib/passkeys'
import { BlockHeightProvider } from '@/app/contexts/BlockHeightContext'

// Combined providers component
export function Providers({
  children,
  initialBlockHeight,
}: {
  children: React.ReactNode
  initialBlockHeight?: number
}) {
  // Initialize React Query client
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10 * 60 * 1000, // 10 minutes
        refetchOnWindowFocus: false, // Disable automatic refetch on window focus
        retry: 1,
        refetchOnMount: false, // Disable refetch on component mount
        refetchOnReconnect: false, // Disable refetch on reconnect
      },
    },
  }))

  useEffect(() => {
    cleanupOldPasskeyTestData()
    return installTempPasswordLifecycleGuards()
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <BlockHeightProvider initialBlockHeight={initialBlockHeight}>
        {children}
      </BlockHeightProvider>
    </QueryClientProvider>
  )
} 