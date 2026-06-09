'use client'

import React from "react"
import { Loader2, RefreshCw } from "lucide-react"
import { useBlockHeightContext } from "@/app/contexts/BlockHeightContext"
import { useBSVPrice } from "@/app/hooks/use-bsv-price"
import { Button } from "@/app/components/ui/button"
import { formatCompactSupply } from "@/app/lib/formatCompactSupply"
import { formatTokenTicker } from "@/app/lib/formatTokenTicker"
import { useNetworkStats } from "@/app/hooks/use-network-stats"

// Wrap the panel content in a separate component
function NetworkStatsPanelContent() {
  const { blockHeight } = useBlockHeightContext();
  const { bsvPrice, isLoading: isPriceLoading } = useBSVPrice();
  const { data, isLoading: isMintedSupplyLoading, refetch } = useNetworkStats();
  const refreshMintedSupply = React.useCallback(() => refetch({ refresh: true }), [refetch]);
  const tokenTicker = data ? formatTokenTicker(data.symbol) : '';
  
  return (
    <div className="sticky top-28 max-h-[calc(100vh-8rem)] overflow-y-auto pb-12">
      {/* Network info section - Enhanced card design */}
      <div className="rounded-2xl border border-border/60 bg-background/60 backdrop-blur overflow-hidden shadow-[0_0_0_1px_rgba(245,158,11,0.06)] hover:shadow-[0_0_0_1px_rgba(245,158,11,0.12),0_18px_40px_-24px_rgba(245,158,11,0.2)] transition-all duration-300">

        <div className="grid grid-cols-2 gap-0.5 p-0.5">
          {/* Block Height */}
          <div className="flex flex-col p-3 rounded-xl hover:bg-muted/30 transition-colors">
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500/70 shadow-[0_0_8px_rgba(16,185,129,0.45)] animate-pulse" />
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Block Height</span>
            </div>
            {blockHeight ? (
              <span className="text-sm font-mono tabular-nums text-center text-foreground/90">
                {blockHeight.toLocaleString()}
              </span>
            ) : (
              <div className="flex items-center justify-center h-6">
                <Loader2 className="h-4 w-4 animate-spin text-emerald-500/80" />
              </div>
            )}
          </div>

          {/* Satoshi Price */}
          <div className="flex flex-col p-3 rounded-xl hover:bg-muted/30 transition-colors">
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400/80 shadow-[0_0_8px_rgba(245,158,11,0.55)] animate-pulse" />
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">sat price</span>
            </div>
            {bsvPrice ? (
              <span className="text-sm font-mono tabular-nums text-center text-foreground/90">
                ${(bsvPrice / 100000000).toFixed(8)}
              </span>
            ) : (
              <div className="flex items-center justify-center h-6">
                <Loader2 className="h-4 w-4 animate-spin text-amber-500/80" />
              </div>
            )}
          </div>

          <div className="col-span-2 flex flex-col px-3 pb-3 rounded-xl hover:bg-muted/30 transition-colors">
            <div className="flex items-center justify-between gap-2 mb-1">
              <div className="flex items-center gap-2">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400/80 shadow-[0_0_8px_rgba(245,158,11,0.55)] animate-pulse" />
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Minted Supply</span>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7 rounded-full text-muted-foreground hover:bg-amber-400/10 hover:text-amber-600 dark:hover:text-amber-300"
                onClick={refreshMintedSupply}
                disabled={isMintedSupplyLoading}
                title="Refresh minted supply"
                aria-label="Refresh minted supply"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isMintedSupplyLoading ? 'animate-spin' : ''}`} />
              </Button>
            </div>
            {isMintedSupplyLoading || data === null ? (
              <div className="flex items-center justify-center h-12">
                <Loader2 className="h-4 w-4 animate-spin text-amber-500/80" />
              </div>
            ) : (
              <>
                <span className="text-sm font-mono tabular-nums text-center text-foreground/90">
                  {formatCompactSupply(data.mintedTokens)} / {formatCompactSupply(data.totalTokens)}
                  {tokenTicker ? ` ${tokenTicker}` : ''}
                </span>
                <span className="mt-1 text-center font-mono tabular-nums text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  {data.mintedPercentage.toFixed(2)}% minted
                </span>
                <div className="mt-3 h-1.5 overflow-hidden rounded-full border border-border/60 bg-background/60 backdrop-blur">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-amber-300 via-amber-400 to-amber-500 shadow-[0_0_12px_-2px_rgba(245,158,11,0.7)] transition-[width] duration-500"
                    style={{ width: `${Math.min(data.mintedPercentage, 100)}%` }}
                  />
                </div>
              </>
            )}
          </div>

          {/* Commented out for potential future use */}
          {/* Difficulty */}
          {/* <div className="flex flex-col p-3 rounded-md hover:bg-muted/20 transition-colors">
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500/60 shadow-[0_0_8px_rgba(59,130,246,0.4)] animate-pulse" />
              <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium font-sans">Difficulty</span>
            </div>
            {difficulty ? (
              <span className="text-base font-bold pl-4 font-mono text-muted-foreground font-sans">
                {(difficulty / 1000000000).toFixed(3)} B
              </span>
            ) : (
              <div className="flex items-center justify-center h-6 pl-4">
                <Loader2 className="h-4 w-4 animate-spin text-blue-500/70" />
              </div>
            )}
          </div> */}
          
          {/* Network Hashrate */}
          {/* <div className="flex flex-col p-3 rounded-md hover:bg-muted/20 transition-colors">
            <div className="flex items-center gap-2 mb-1">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-gray-500/60 shadow-[0_0_8px_rgba(107,114,128,0.4)] animate-pulse" />
              <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium font-sans">Hashrate</span>
            </div>
            {formattedHashrate ? (
              <span className="text-base font-bold pl-4 font-mono text-muted-foreground font-sans">
                {Math.round(parseFloat(formattedHashrate.value))} {formattedHashrate.unit}
              </span>
            ) : (
              <div className="flex items-center justify-center h-6 pl-4">
                <Loader2 className="h-4 w-4 animate-spin text-gray-500/70" />
              </div>
            )}
          </div> */}
        </div>
      </div>
    </div>
  )
}

// Main component with Suspense
export default function NetworkStatsPanel() {
  return (
    <React.Suspense
      fallback={
        <div className="h-[300px] rounded-2xl border border-border/60 bg-gradient-to-r from-foreground/[0.04] via-foreground/[0.1] to-foreground/[0.04] bg-[length:200%_100%] animate-gradient-x backdrop-blur" />
      }
    >
      <NetworkStatsPanelContent />
    </React.Suspense>
  )
} 