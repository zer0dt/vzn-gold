'use client'

import { useEffect, Suspense } from 'react'
import { useBlockHeightContext } from '@/app/contexts/BlockHeightContext'
import { useBSVPrice } from '@/app/hooks/use-bsv-price'
import { useWallet } from '@/app/hooks/use-wallet'
import { useQueryClient } from '@tanstack/react-query'
import { useToast } from "@/app/hooks/use-toast"
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/app/contexts/AuthContext'
import VaultLoadingState from './VaultLoadingState'

const VaultContent = dynamic(() => import('./VaultContent'))

export default function VaultClient() {
  const { blockHeight } = useBlockHeightContext()
  const { bsvPrice } = useBSVPrice()
  const { walletAddress, isLoading: isWalletLoading } = useWallet()
  const { toast } = useToast()
  const { user, isLoading: isAuthLoading } = useAuth()
  const queryClient = useQueryClient()
  const router = useRouter()

  useEffect(() => {
    if (!isAuthLoading && !user) {
      router.push('/login')
    }
  }, [isAuthLoading, router, user])

  useEffect(() => {
    if (user) {
      queryClient.invalidateQueries({ queryKey: ['likes'] })
    }
  }, [queryClient, user])

  // Show loading while auth or wallet is loading
  if (isAuthLoading || isWalletLoading) {
    return <VaultLoadingState />
  }

  if (!user) {
    return <VaultLoadingState />
  }

  // Show connect wallet message if authenticated but no wallet
  if (!walletAddress) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
        <h2 className="text-lg font-medium text-muted-foreground">
          Connect your wallet to view locked transactions
        </h2>
      </div>
    )
  }

  // Show content when everything is ready
  return (
    <Suspense fallback={<VaultLoadingState />}>
      <VaultContent 
        userId={user.id}
        blockHeight={blockHeight}
        bsvPrice={bsvPrice}
        toast={toast}
        queryClient={queryClient}
      />
    </Suspense>
  )
} 