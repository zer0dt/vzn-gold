import { createClient } from '@/utils/supabase/server'
import type { Like, LeaderboardProfileWithLikes } from '@/types'
import { Suspense } from 'react'
import { Loader2, ArrowLeft } from "lucide-react"
import { TotalValueLockedDisplay } from './TotalValueLockedDisplay'
import dynamic from 'next/dynamic'

const LeaderboardList = dynamic(() => import('./LeaderboardList'), { 
  ssr: true,
  loading: () => <div className="space-y-3">
    {[...Array(5)].map((_, i) => (
      <div key={i} className="flex items-center gap-4 p-4 rounded-2xl border border-border/60 bg-background/60 backdrop-blur">
        <div className="h-12 w-12 rounded-full bg-gradient-to-r from-foreground/[0.05] via-foreground/[0.12] to-foreground/[0.05] animate-gradient-x" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-3/4 rounded-full bg-gradient-to-r from-foreground/[0.05] via-foreground/[0.12] to-foreground/[0.05] animate-gradient-x" />
          <div className="h-3 w-1/2 rounded-full bg-gradient-to-r from-foreground/[0.05] via-foreground/[0.12] to-foreground/[0.05] animate-gradient-x" />
        </div>
        <div className="space-y-2">
          <div className="h-4 w-20 rounded-full bg-gradient-to-r from-foreground/[0.05] via-foreground/[0.12] to-foreground/[0.05] animate-gradient-x" />
          <div className="h-3 w-16 rounded-full bg-gradient-to-r from-foreground/[0.05] via-foreground/[0.12] to-foreground/[0.05] animate-gradient-x" />
        </div>
      </div>
    ))}
  </div>
})

const BackButton = dynamic(() => import('@/app/components/BackButton'), { 
  loading: () => <div className="w-9 h-9"></div>
})

async function getLeaderboardData() {
  const supabase = await createClient()

  const priceResponse = await fetch('https://api.whatsonchain.com/v1/bsv/main/exchangerate', {
    next: { revalidate: 60 }
  })
  if (!priceResponse.ok) {
    console.error("Failed to fetch BSV price:", priceResponse.statusText);
    throw new Error("Failed to fetch BSV price");
  }
  const priceData = await priceResponse.json()
  const bsvPrice = parseFloat(priceData.rate)

  const blockResponse = await fetch('https://api.whatsonchain.com/v1/bsv/main/chain/info', {
    next: { revalidate: 60 }
  })
   if (!blockResponse.ok) {
    console.error("Failed to fetch block height:", blockResponse.statusText);
    throw new Error("Failed to fetch block height");
  }
  const blockData = await blockResponse.json()
  const blockHeight = blockData.blocks

  const { data: profiles, error: profileError } = await supabase
    .from('profiles')
    .select(`
      *,
      likes!inner (
        sats_amount,
        unlock_height,
        blocks_locked,
        is_spent
      )
    `)
    .gte('likes.unlock_height', blockHeight)  // Only get locks that haven't expired
    .eq('likes.is_spent', false)  // Only get unspent locks

  if (profileError) {
    console.error("Error fetching profiles for leaderboard:", profileError);
    return { rankedProfiles: [] as LeaderboardProfileWithLikes[], bsvPrice, totalSatsLocked: 0 };
  }

  // Calculate total active locked sats for each profile
  let totalSatsLocked = 0; // Initialize total locked sats
  const rankedProfiles: LeaderboardProfileWithLikes[] = profiles?.map(profile => {
    const profileTotal = profile.likes.reduce((sum: number, like: Like) =>
      sum + like.sats_amount, 0
    );
    totalSatsLocked += profileTotal; // Add to the grand total
    
    // Calculate $VZN based on qualifying likes (700+ blocks locked AND 10M+ sats = 1000 VZN each)
    const qualifyingLikes = profile.likes.filter((like: Like) => 
      like.blocks_locked >= 700 && like.sats_amount >= 10000000
    );
    const mockVZN = qualifyingLikes.length * 1000;
    
    return {
      ...profile,
      totalLockedSats: profileTotal,
      activeLocksCount: profile.likes.length,
      mockVZN: mockVZN
    } as LeaderboardProfileWithLikes
  })
  .sort((a, b) => b.totalLockedSats - a.totalLockedSats) || []; // Ensure rankedProfiles is an array

  // Return totalSatsLocked along with profiles and price
  return { rankedProfiles, bsvPrice, totalSatsLocked }
}

// Rendered dynamically on every request (the page is opted out of static
// caching by `cookies()` inside createClient). The Supabase query therefore
// returns fresh rows on each navigation; only the two whatsonchain fetches
// are cached for 60s to avoid hammering the public API.
async function LeaderboardDisplay() {
  const { rankedProfiles, bsvPrice, totalSatsLocked } = await getLeaderboardData();

  return (
    <div className="space-y-4">
      <TotalValueLockedDisplay
        totalSatsLocked={totalSatsLocked}
        bsvPrice={bsvPrice}
      />

      <LeaderboardList
        rankedProfiles={rankedProfiles}
        bsvPrice={bsvPrice}
      />
    </div>
  );
}

export default async function LeaderboardPage() {
  return (
    <div className="w-full max-w-2xl lg:mt-8 mt-8 mx-auto px-4 pb-8">
      {/* Header with Back Button */}
      <div className="flex items-center gap-3 mb-6">
        <BackButton>
          <ArrowLeft className="h-5 w-5" />
        </BackButton>
        <div className="flex-1 flex justify-between items-center">
          <h1 className="font-vzn-headings text-2xl font-normal tracking-tight">Leaderboard</h1>
        </div>
      </div>
      
      <Suspense fallback={
        <div className="flex flex-col items-center justify-center min-h-[300px] gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-amber-500 dark:text-amber-400" />
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Loading leaderboard…</p>
        </div>
      }>
        <LeaderboardDisplay />
      </Suspense>
    </div>
  )
}

