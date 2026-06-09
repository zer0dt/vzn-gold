'use client'

import { useState, useCallback } from 'react'
import { formatUSD, formatSatsAbbreviated } from '@/app/lib/utils' // Import formatters

interface TotalValueLockedDisplayProps {
  totalSatsLocked: number;
  bsvPrice: number;
}

export function TotalValueLockedDisplay({ totalSatsLocked, bsvPrice }: TotalValueLockedDisplayProps) {
  const [showUSD, setShowUSD] = useState(false);

  const toggleDisplay = useCallback(() => {
    setShowUSD(prev => !prev);
  }, []);

  return (
    <div
      className="relative overflow-hidden rounded-2xl border border-amber-400/40 bg-gradient-to-b from-amber-400/[0.12] to-amber-400/[0.02] backdrop-blur p-8 text-center mb-8 cursor-pointer transition-all duration-500 group shadow-[0_0_0_1px_rgba(245,158,11,0.15),0_18px_45px_-20px_rgba(245,158,11,0.35)] hover:border-amber-400/60 hover:shadow-[0_0_0_1px_rgba(245,158,11,0.3),0_22px_55px_-20px_rgba(245,158,11,0.5)]"
      onClick={toggleDisplay}
    >
      <div className="absolute inset-0 bg-gradient-to-r from-amber-400/[0.08] via-amber-300/[0.06] to-amber-400/[0.08] opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
      <div className="absolute top-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-amber-400/60 to-transparent" />
      <div className="absolute bottom-0 left-0 w-full h-[1px] bg-gradient-to-r from-transparent via-amber-400/40 to-transparent" />

      <span className="relative font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground mb-2 block">Total Value Locked</span>
      <div className={`relative text-4xl font-normal tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-[#FBBF24] via-[#F59E0B] to-[#FBBF24] ${showUSD ? 'font-sans' : 'font-bitcount'}`}>
        {/* Conditionally render Sats or USD */}
        {showUSD
          ? formatUSD(totalSatsLocked, bsvPrice)
          : `${formatSatsAbbreviated(totalSatsLocked)} sats`}
      </div>
      <div className="relative mt-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        Click to toggle currency
      </div>
    </div>
  );
} 