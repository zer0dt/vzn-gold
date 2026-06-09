import { Suspense, cache } from 'react'
import { HydrationBoundary, QueryClient, dehydrate } from '@tanstack/react-query'
import { createClient } from '@/utils/supabase/server'
import type { Metadata } from 'next'
import { fetchPostByTxid } from '@/app/lib/supabase/posts'
import { singlePostQueryKeys } from '@/app/lib/query-keys'

import { notFound } from 'next/navigation'
import NextDynamic from 'next/dynamic'
import type { Like } from '@/types'
import { PostSkeleton } from '@/app/components/PostSkeleton'
import { ClientPost } from '@/app/components/ClientPost'
import { ScrollToTop } from '@/app/components/ScrollToTop'
import { ArrowLeft } from 'lucide-react'
import TxPageTitle from './TxPageTitle'
import PostMintStats from './PostMintStats'

// Import the BackButton as a client component
const BackButton = NextDynamic(() => import('@/app/components/BackButton'), { 
  loading: () => <div className="w-9 h-9"></div>
})

// Ensure this route is always dynamic so metadata reflects current locks
export const dynamic = 'force-dynamic'

async function getCurrentBlockHeight(): Promise<number> {
  try {
    const response = await fetch('https://api.whatsonchain.com/v1/bsv/main/chain/info', {
      cache: 'no-store',
    })
    if (!response.ok) return 0
    const data = await response.json()
    return Number(data?.blocks ?? 0)
  } catch {
    return 0
  }
}

// Fetch post data server-side
const getPostData = cache(async (txid: string) => {
  const supabase = await createClient()

  return fetchPostByTxid(supabase, txid)
})

// Generate metadata for SEO
export async function generateMetadata(
  { params }: { params: Promise<{ txid: string }> }
): Promise<Metadata> {
  const { txid } = await params
  const post = await getPostData(txid)
  
  if (!post) return { title: 'Post not found' }
  
  // Match display name logic used in PostHeader
  const username = post.profile?.username || (post.user_id ? `User ${post.user_id.substring(0, 6)}...` : 'Anonymous')
  const contentSnippet =
    (post.content?.substring(0, 150) ?? '') + ((post.content?.length ?? 0) > 150 ? '...' : '')
  
  // Calculate currently locked sats based on current block height
  const currentBlockHeight = await getCurrentBlockHeight()
  const activeLikes = Array.isArray(post.likes)
    ? post.likes.filter((like: Like) => Number(like?.unlock_height ?? 0) > currentBlockHeight)
    : []
  const lockedSats = activeLikes.reduce(
    (sum: number, like: Like) => sum + Number(like?.sats_amount ?? 0),
    0
  )
  
  // Create status text based on locked amount
  const satoshiText = lockedSats > 0 
    ? `${lockedSats.toLocaleString()} sats locked` 
    : 'No sats locked yet'
  
  return {
    title: `${username}'s post - ${satoshiText}`,
    description: contentSnippet,
    openGraph: {
      title: `${username}'s post - ${satoshiText}`,
      description: contentSnippet,
      type: 'article',
    },
    twitter: {
      card: 'summary_large_image',
      title: `${username}'s post - ${satoshiText}`,
      description: contentSnippet,
    },
    other: {
      'article:satoshis': lockedSats.toString(),
      'article:hasLocks': lockedSats > 0 ? 'true' : 'false',
    },
  }
}

// Update the PostWithData component
async function PostWithData({ txid }: { txid: string }) {
  const queryClient = new QueryClient()
  const post = await getPostData(txid)
  
  if (!post) {
    notFound()
  }

  queryClient.setQueryData(singlePostQueryKeys.byTxid(txid), post)
  
  return (
    <div className="w-full max-w-2xl lg:mt-8 mt-8 mx-auto pb-8">
      <ScrollToTop />
      {/* Header with Back Button */}
      <div className="flex items-center gap-3 mb-6 px-4">
        <BackButton>
          <ArrowLeft className="h-5 w-5" />
        </BackButton>
        <div className="flex-1 flex justify-between items-center">
          <TxPageTitle txid={txid} />
        </div>
      </div>

      <Suspense fallback={<PostSkeleton />}>
        <HydrationBoundary state={dehydrate(queryClient)}>
          <ClientPost post={post} />
        </HydrationBoundary>
      </Suspense>

      <div className="px-4 mt-6">
        <PostMintStats
          txid={txid}
          initialLikeCount={Array.isArray(post.likes) ? post.likes.length : 0}
          initialLikes={Array.isArray(post.likes) ? post.likes : []}
          postAuthorUserId={post.user_id ?? null}
        />
      </div>
    </div>
  )
}

// Loading skeleton that matches the new layout
function TxPageSkeleton() {
  return (
    <div className="w-full max-w-2xl lg:mt-8 mt-8 mx-auto px-4 pb-8">
      {/* Header skeleton */}
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-full bg-muted animate-pulse"></div>
        <div className="h-7 w-28 bg-muted rounded animate-pulse"></div>
      </div>
      
      <PostSkeleton />
    </div>
  )
}

// Main page component (server)
export default async function PostPage({ params }: { params: Promise<{ txid: string }> }) {
  const { txid } = await params
  return (
    <Suspense fallback={<TxPageSkeleton />}>
      <PostWithData txid={txid} />
    </Suspense>
  );
}
