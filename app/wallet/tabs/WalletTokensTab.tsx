'use client'

import Image from 'next/image'
import { Loader2, RefreshCw } from 'lucide-react'
import { useNetworkStats } from '@/app/hooks/use-network-stats'
import { formatTokenTicker } from '@/app/lib/formatTokenTicker'

export default function WalletTokensTab({
  isFetchingVznBalance,
  fetchVznBalance,
  vznBalance,
  onTradeClick,
}: {
  isFetchingVznBalance: boolean
  fetchVznBalance: () => void
  vznBalance: number
  onTradeClick: () => void
}) {
  const { data } = useNetworkStats()
  const ticker = formatTokenTicker(data?.symbol ?? 'VZN')

  return (
    <div className="rounded-2xl border border-border/60 bg-background/60 backdrop-blur p-4 shadow-[0_0_0_1px_rgba(245,158,11,0.08)]">
      <div className="flex items-center justify-between">
        <div
          className="flex items-center space-x-3 group cursor-pointer"
          onClick={onTradeClick}
        >
          <div className="w-12 h-12 rounded-full overflow-hidden ring-1 ring-amber-400/30 shadow-[0_8px_24px_-12px_rgba(245,158,11,0.45)] relative">
            <Image src="/vision.png" alt="VZN" fill className="object-cover" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <h3 className="font-vzn-headings text-lg font-normal tracking-tight text-foreground group-hover:underline">Vision</h3>
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">({ticker})</span>
          </div>
        </div>
        <div
          className="text-right cursor-pointer group"
          onClick={!isFetchingVznBalance ? fetchVznBalance : undefined}
          title={`Click to refresh ${ticker} balance`}
        >
          <div className="flex items-center space-x-2">
            <p className="text-xl sm:text-2xl font-normal text-foreground font-bitcount">
              {isFetchingVznBalance ? '...' : vznBalance.toLocaleString()}
            </p>
            {isFetchingVznBalance ? (
              <Loader2 className="h-4 w-4 animate-spin text-amber-500 dark:text-amber-400" />
            ) : (
              <RefreshCw className="h-3 w-3 text-muted-foreground group-hover:text-amber-500 dark:group-hover:text-amber-300 transition-colors" />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
