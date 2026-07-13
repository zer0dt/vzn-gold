'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, GitFork, Loader2, RefreshCw } from 'lucide-react'
import Link from 'next/link'
import { useCallback, useState } from 'react'

import { Button } from '@/app/components/ui/button'
import { useRealtimeUpdates } from '@/app/hooks/useRealtimeUpdates'
import FractalTransactionTree from '@/app/tree/FractalTransactionTree'
import type { LikeRealtimeSnapshot } from '@/types'
import type { MintTreeResponse } from './types'

async function fetchMintTree(): Promise<MintTreeResponse> {
  const response = await fetch('/api/overlay/minters/tree', { cache: 'no-store' })
  const payload = (await response.json()) as MintTreeResponse & { error?: string }
  if (!response.ok) throw new Error(payload.error || 'Unable to load mint tree')
  return payload
}

function shortOrigin(originId: string): string {
  return originId.length > 24
    ? `${originId.slice(0, 10)}…${originId.slice(-8)}`
    : originId
}

export default function TreePageClient({ originId }: { originId: string }) {
  const queryClient = useQueryClient()
  const [realtimeTxids, setRealtimeTxids] = useState<Set<string>>(() => new Set())
  const query = useQuery({
    queryKey: ['mint-fractal-tree', originId],
    queryFn: fetchMintTree,
    enabled: Boolean(originId),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  })

  const handleNewLike = useCallback(
    (like: LikeRealtimeSnapshot) => {
      if (like.contract_id !== originId) return
      setRealtimeTxids((current) => new Set(current).add(like.txid))

      void queryClient.invalidateQueries({
        queryKey: ['mint-fractal-tree', originId],
        exact: true,
      })
    },
    [originId, queryClient]
  )

  useRealtimeUpdates<LikeRealtimeSnapshot>('likes', handleNewLike)

  return (
    <div className="min-h-dvh">
      <header className="border-b border-border/70 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex min-h-14 max-w-[1800px] flex-wrap items-center justify-between gap-y-2 px-3 py-2 sm:h-14 sm:flex-nowrap sm:px-6 sm:py-0">
          <div className="flex w-full min-w-0 items-center gap-2 sm:w-auto sm:flex-1 sm:gap-3">
            <Button
              asChild
              variant="ghost"
              size="icon"
              className="h-11 w-11 shrink-0 rounded-full sm:h-10 sm:w-10"
            >
              <Link href="/" aria-label="Back to VZN.gold">
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <GitFork className="h-4 w-4 shrink-0 text-primary" />
                <h1 className="truncate font-vzn-headings text-base font-normal tracking-tight sm:text-lg">
                  LockLikeMintBSV21Parallel (LLM21)
                </h1>
              </div>
              <p className="truncate font-mono text-[10px] text-muted-foreground">
                {originId ? shortOrigin(originId) : 'Origin not configured'} - $VZN
              </p>
            </div>
          </div>

          {query.data && (
            <div className="hidden items-center gap-5 text-xs sm:flex">
              <span>
                <strong className="font-mono font-semibold text-amber-700 dark:text-amber-400">
                  {query.data.stats.likedBranchCount}
                </strong>{' '}
                <span className="text-muted-foreground">likes</span>
              </span>
              <span>
                <strong className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                  {query.data.stats.liveOutputCount}
                </strong>{' '}
                <span className="text-muted-foreground">live minters</span>
              </span>
              <span>
                <strong className="font-mono font-semibold">{query.data.stats.maxDepth}</strong>{' '}
                <span className="text-muted-foreground">generations</span>
              </span>
            </div>
          )}

          {query.data && (
            <div className="grid w-full grid-cols-3 border-t border-border/60 pt-2 text-center text-[11px] sm:hidden">
              <span>
                <strong className="font-mono font-semibold text-amber-700 dark:text-amber-400">
                  {query.data.stats.likedBranchCount}
                </strong>{' '}
                <span className="text-muted-foreground">likes</span>
              </span>
              <span>
                <strong className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                  {query.data.stats.liveOutputCount}
                </strong>{' '}
                <span className="text-muted-foreground">live</span>
              </span>
              <span>
                <strong className="font-mono font-semibold">{query.data.stats.maxDepth}</strong>{' '}
                <span className="text-muted-foreground">generations</span>
              </span>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-[1800px] py-2 sm:py-5 lg:px-6">
        {!originId ? (
          <div className="mx-4 mt-20 max-w-xl border border-border bg-background p-6 lg:mx-auto">
            <h2 className="font-vzn-headings text-xl">Origin ID is not configured</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Set NEXT_PUBLIC_LLM21_ORIGIN_ID and restart the application.
            </p>
          </div>
        ) : query.isPending ? (
          <div className="flex min-h-[65dvh] items-center justify-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
            Loading $VZN tree…
          </div>
        ) : query.isError ? (
          <div className="mx-4 mt-20 max-w-xl border border-border bg-background p-6 lg:mx-auto">
            <h2 className="font-vzn-headings text-xl">The tree could not be reconstructed</h2>
            <p className="mt-2 text-sm text-muted-foreground">{query.error.message}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-5"
              onClick={() => query.refetch()}
            >
              <RefreshCw className="mr-2 h-3.5 w-3.5" />
              Try again
            </Button>
          </div>
        ) : query.data ? (
          <FractalTransactionTree tree={query.data} realtimeTxids={realtimeTxids} />
        ) : null}
      </main>
    </div>
  )
}
