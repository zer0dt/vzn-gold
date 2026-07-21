'use client'

import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { Loader2, Coins, Users } from 'lucide-react'

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from '@/app/components/ui/avatar'
import { singlePostQueryKeys } from '@/app/lib/query-keys'
import type { HydratedPost } from '@/app/lib/supabase/posts'
import { useNetworkStats } from '@/app/hooks/use-network-stats'
import { formatCompactSupply } from '@/app/lib/formatCompactSupply'
import { formatTokenTicker } from '@/app/lib/formatTokenTicker'
import { formatSatsAbbreviated } from '@/app/lib/utils'

type HydratedLike = NonNullable<HydratedPost['likes']>[number]

type PostMintStatsProps = {
  txid: string
  initialLikeCount: number
  initialLikes?: HydratedLike[]
  postAuthorUserId?: string | null
}

type HolderRow = {
  userId: string
  profile: HydratedLike['liker_profile']
  locks: number
  sats: number
  minted: number
  share: number
}

export default function PostMintStats({
  txid,
  initialLikeCount,
  initialLikes,
  postAuthorUserId,
}: PostMintStatsProps) {
  // Subscribe to the same post cache ClientPost hydrates & updates via realtime
  // so the count stays in sync as new locks arrive. `enabled: false` keeps this
  // as a pure cache reader — ClientPost owns the actual fetching.
  const { data: cachedPost } = useQuery<HydratedPost | null>({
    queryKey: singlePostQueryKeys.byTxid(txid),
    queryFn: () => null,
    enabled: false,
    staleTime: Infinity,
  })

  const likes = (cachedPost?.likes ?? initialLikes ?? []) as HydratedLike[]
  const likeCount = likes.length || initialLikeCount

  const { data: stats, isLoading } = useNetworkStats()

  const mintLimit = stats?.mintLimit ?? 0
  const symbolLabel = stats?.symbol != null && stats.symbol.trim() !== '' ? formatTokenTicker(stats.symbol) : ''

  const { postMinted, globalMinted, percentOfMinted } = useMemo(() => {
    const global = stats?.mintedTokens ?? 0
    const minted = likeCount * mintLimit
    const pct = global > 0 ? (minted / global) * 100 : 0
    return {
      postMinted: minted,
      globalMinted: global,
      percentOfMinted: pct,
    }
  }, [likeCount, mintLimit, stats?.mintedTokens])

  const holders: HolderRow[] = useMemo(() => {
    if (!likes.length) return []
    const byUser = new Map<string, HolderRow>()
    for (const like of likes) {
      const userId = like.user_id
      if (!userId) continue
      const sats = Number(like.sats_amount ?? 0)
      const existing = byUser.get(userId)
      if (existing) {
        existing.locks += 1
        existing.sats += sats
      } else {
        byUser.set(userId, {
          userId,
          profile: like.liker_profile,
          locks: 1,
          sats,
          minted: 0,
          share: 0,
        })
      }
    }
    const rows = [...byUser.values()]
    for (const row of rows) {
      row.minted = row.locks * mintLimit
    }
    rows.sort((a, b) => b.locks - a.locks || b.sats - a.sats)
    const topMinted = rows[0]?.minted ?? 0
    for (const row of rows) {
      row.share = topMinted > 0 ? (row.minted / topMinted) * 100 : 0
    }
    return rows
  }, [likes, mintLimit])

  const isReady = !isLoading && stats !== null

  return (
    <div className="rounded-2xl border border-border/50 bg-muted/20 overflow-hidden">
      <div className="flex flex-col px-4 py-3">
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-2">
            <Coins className="h-3.5 w-3.5 text-muted-foreground/70" />
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              Minted from this post
            </span>
          </div>
          {isReady && (
            <span className="font-mono tabular-nums text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
              {percentOfMinted < 0.01 && percentOfMinted > 0
                ? '<0.01'
                : percentOfMinted.toFixed(2)}
              % of minted
            </span>
          )}
        </div>

        {!isReady ? (
          <div className="flex items-center justify-center h-10">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/60" />
          </div>
        ) : (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium font-mono tabular-nums text-foreground/80">
                {formatCompactSupply(postMinted)}
                {symbolLabel ? ` ${symbolLabel}` : ''}
              </span>
              <span className="text-xs font-mono tabular-nums text-muted-foreground">
                of {formatCompactSupply(globalMinted)}
                {symbolLabel ? ` ${symbolLabel}` : ''}
              </span>
            </div>

            <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-muted/50">
              <div
                className="h-full rounded-full bg-amber-500/45 transition-[width] duration-500"
                style={{ width: `${Math.min(Math.max(percentOfMinted, 0), 100)}%` }}
              />
            </div>
          </>
        )}
      </div>

      <div className="border-t border-border/40 px-4 py-3">
        <div className="flex items-center gap-2 mb-2">
          <Users className="h-3.5 w-3.5 text-muted-foreground/70" />
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Holders
          </span>
        </div>

        {holders.length === 0 ? (
          <div className="py-4 text-center text-sm text-muted-foreground font-post-sans">
            No holders yet — be the first to lock.
          </div>
        ) : (
          <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
            {holders.map((entry, index) => {
              const profile = entry.profile
              const profileTarget = profile?.username || entry.userId
              const profileHref = profileTarget ? `/${profileTarget}` : null
              const displayName =
                profile?.username ||
                (entry.userId ? `..${entry.userId.slice(-6)}` : 'Anon')
              const isOp = entry.userId === postAuthorUserId
              const mintedPct =
                postMinted > 0 ? (entry.minted / postMinted) * 100 : 0

              return (
                <div
                  key={entry.userId}
                  className="flex items-center gap-3 rounded-xl px-2 py-1.5 transition-colors hover:bg-muted/30"
                >
                  <span className="w-5 text-center font-post-mono text-[10px] tabular-nums text-muted-foreground">
                    {index + 1}
                  </span>

                  {profileHref ? (
                    <Link
                      href={profileHref}
                      title={`View profile: ${displayName}`}
                      className="flex-shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      <Avatar className="h-8 w-8 flex-shrink-0 ring-1 ring-border/60 bg-muted transition-opacity hover:opacity-80">
                        {profile?.avatar_url ? (
                          <AvatarImage
                            src={profile.avatar_url}
                            alt={`${displayName} avatar`}
                          />
                        ) : (
                          <AvatarImage src="/default-avy.png" alt="default" />
                        )}
                        <AvatarFallback>
                          {displayName.charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    </Link>
                  ) : (
                    <Avatar className="h-8 w-8 flex-shrink-0 ring-1 ring-border/60 bg-muted">
                      <AvatarImage src="/default-avy.png" alt="default" />
                      <AvatarFallback>
                        {displayName.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      {profileHref ? (
                        <Link
                          href={profileHref}
                          className="flex min-w-0 items-center gap-1 truncate text-[13px] font-post-sans text-foreground transition-colors hover:text-foreground/80 hover:underline underline-offset-2 decoration-border rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                          title={profileTarget}
                        >
                          <span className="truncate">{displayName}</span>
                          {isOp && (
                            <span className="inline-flex flex-shrink-0 items-center rounded-full border border-border/60 bg-muted/50 px-1 py-0 font-mono text-[8px] uppercase tracking-[0.12em] text-muted-foreground">
                              OP
                            </span>
                          )}
                        </Link>
                      ) : (
                        <span className="flex min-w-0 items-center gap-1 truncate text-[13px] font-post-sans text-muted-foreground">
                          <span className="truncate">{displayName}</span>
                        </span>
                      )}
                      <span className="flex-shrink-0 font-post-mono text-[12px] tabular-nums text-muted-foreground">
                        {formatCompactSupply(entry.minted)}
                        {symbolLabel ? ` ${symbolLabel}` : ''}
                      </span>
                    </div>

                    <div className="relative mt-1 h-0.5 overflow-hidden rounded-full bg-muted/40">
                      <div
                        className="absolute inset-y-0 left-0 rounded-full bg-amber-500/35"
                        style={{ width: `${Math.min(Math.max(entry.share, 0), 100)}%` }}
                      />
                    </div>

                    <div className="mt-1 flex items-center justify-between gap-2 font-post-mono text-[10px] tabular-nums text-muted-foreground">
                      <span>
                        {entry.locks} lock{entry.locks === 1 ? '' : 's'} ·{' '}
                        {formatSatsAbbreviated(entry.sats)} sats
                      </span>
                      <span>
                        {mintedPct < 0.01 && mintedPct > 0
                          ? '<0.01'
                          : mintedPct.toFixed(2)}
                        % of post
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
