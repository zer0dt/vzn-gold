'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { createClient } from '@/utils/supabase/client'
import { Loader2 } from "lucide-react"
import { Tabs, TabsList, TabsTrigger } from "@/app/components/ui/tabs"
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { useBlockHeightContext } from '@/app/contexts/BlockHeightContext'
import dynamic from 'next/dynamic'
import type { PostProps } from '@/app/components/Post/postTypes'
import type { RealtimePayload, Like, Reply, Profile } from '@/types'
import { PostSkeleton } from "./PostSkeleton"
import { useSearchParams } from 'next/navigation'
import { useRealtimeUpdates } from '@/app/hooks/useRealtimeUpdates'
import { profileQueryKeys, replyQueryKeys } from '@/app/lib/query-keys'
import {
  consumeOptimisticReply,
  fetchProfileFeedPage,
  syncReplyCountAcrossPostCaches,
  type HydratedPost,
  type ProfileFeedPage,
} from '@/app/lib/supabase/posts'
import { getProfileByUserId as fetchProfileByUserId } from '@/app/lib/supabase/profiles'

const Post = dynamic<{ post: PostProps['post']; blockHeight: number }>(() => import('./Post/index').then((mod) => mod.Post), {
  loading: () => <PostSkeleton />
})

const supabase = createClient()

type FeedType = "new" | "top" | "liked"

// Import Profile type from parent or shared types if necessary
// Assuming ProfileFeedProps correctly receives the updated Profile type
type ProfileFeedProps = {
  profile: { // Use the structure expected from UserProfileClient
    user_id: string;
    created_at: string;
    updated_at: string;
    username: string | null;
    avatar_url: string | null;
    cover_url: string | null;
  };
}

export function ProfileFeed({ profile }: ProfileFeedProps) {
  const searchParams = useSearchParams()
  const observerTarget = useRef<HTMLDivElement | null>(null)
  const [activeTab, setActiveTab] = useState<FeedType>("new")
  const [hasNewPosts, setHasNewPosts] = useState(false)
  const [isShowingNewPosts, setIsShowingNewPosts] = useState(false)
  const latestPostTimestampRef = useRef<string | null>(null)
  const profileCacheRef = useRef<Map<string, Profile>>(new Map())
  const showMarketplace = searchParams.get('trade') === 'true'
  const { blockHeight } = useBlockHeightContext()
  const currentBlockHeight = blockHeight || 0
  const queryClient = useQueryClient()
  const [tradeMode, setTradeMode] = useState<'buy' | 'sell'>('buy')
  const [tradeAmount, setTradeAmount] = useState<string>("10")
  const [selectedPrice, setSelectedPrice] = useState<number | null>(null)
  const profilePostsQueryKey = profileQueryKeys.byTab(activeTab, profile.user_id)

  // Define the buy and sell orders
  const buyOrders = [
    { price: 4000, amount: 2 },
    { price: 3800, amount: 3 },
    { price: 3600, amount: 4 }
  ]
  
  const sellOrders = [
    { price: 4400, amount: 1 },
    { price: 4600, amount: 2 },
    { price: 4800, amount: 3 }
  ]

  // Initialize with the lowest sell order when the marketplace is shown
  useEffect(() => {
    if (showMarketplace && sellOrders.length > 0) {
      const lowestSellOrder = sellOrders[0]
      setTradeAmount((lowestSellOrder.amount * 1000).toString())
      setSelectedPrice(lowestSellOrder.price)
      setTradeMode('buy')
    }
  }, [showMarketplace])

  // Fetch posts with infinite scroll
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    status
  } = useInfiniteQuery({
    queryKey: profilePostsQueryKey,
    queryFn: ({ pageParam = 0 }) =>
      profile.user_id
        ? fetchProfileFeedPage(supabase, {
            tab: activeTab,
            profileUserId: profile.user_id,
            blockHeight: currentBlockHeight,
            page: pageParam as number,
          })
        : Promise.resolve({ data: [], nextPage: null }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextPage,
    // Update enabled condition to use user_id
    enabled: !!profile.user_id && (activeTab === 'new' || !!currentBlockHeight)
  })

  const getProfileByUserId = useCallback(
    async (userId: string | null | undefined, fallbackUsername = 'Anon') =>
      fetchProfileByUserId(supabase, userId, {
        cache: profileCacheRef.current,
        fallbackUsername,
      }),
    []
  )

  // Flatten posts from all pages
  const posts = data?.pages.flatMap(page => page.data) ?? []

  const previousBlockHeightRef = useRef(0)

  useEffect(() => {
    if (!profile.user_id || !currentBlockHeight || currentBlockHeight === previousBlockHeightRef.current) {
      return
    }

    queryClient.invalidateQueries({
      queryKey: profileQueryKeys.top(profile.user_id),
      exact: true,
      refetchType: 'all',
    })
    queryClient.invalidateQueries({
      queryKey: profileQueryKeys.liked(profile.user_id),
      exact: true,
      refetchType: 'all',
    })

    previousBlockHeightRef.current = currentBlockHeight
  }, [currentBlockHeight, profile.user_id, queryClient])

  const handleNewReply = useCallback(async (newReply: Reply) => {
    const wasOptimisticReply = consumeOptimisticReply(newReply.txid)
    const replierProfile = await getProfileByUserId(newReply.user_id, 'Anon')

    const enrichedReply = {
      ...newReply,
      profile: replierProfile || { username: null, avatar_url: null },
    }

    let replyWasNew = false

    queryClient.setQueryData<Reply[]>(replyQueryKeys.byPost(newReply.post_txid), (oldData) => {
      const currentReplies = oldData || []
      if (currentReplies.some((reply) => reply.txid === newReply.txid)) {
        return currentReplies
      }

      replyWasNew = true
      return [...currentReplies, enrichedReply]
    })

    if (wasOptimisticReply || !replyWasNew) {
      return
    }

    syncReplyCountAcrossPostCaches(queryClient, newReply.post_txid)
  }, [getProfileByUserId, queryClient])

  // Update latest post timestamp when new data arrives for the 'new' tab
  useEffect(() => {
    if (activeTab === 'new' && posts.length > 0 && posts[0].created_at) {
      const newTimestamp = posts[0].created_at;
      // Store the timestamp of the newest post currently displayed
      if (!latestPostTimestampRef.current || newTimestamp > latestPostTimestampRef.current) {
         console.log(`[Ref Update] Updating latestPostTimestampRef from ${latestPostTimestampRef.current} to ${newTimestamp}`);
         latestPostTimestampRef.current = newTimestamp;
      }
    }
    // Reset timestamp if switching away from 'new' tab or posts become empty
    // This prevents stale comparisons if the user switches back
    if (activeTab !== 'new' || posts.length === 0) {
        latestPostTimestampRef.current = null;
    }
  }, [data, activeTab, posts])

  // Setup infinite scroll
  useEffect(() => {
    if (!observerTarget.current) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage()
        }
      },
      { threshold: 0.1, rootMargin: '0px 0px 600px 0px' }
    )

    observer.observe(observerTarget.current)
    return () => observer.disconnect()
  }, [observerTarget, hasNextPage, isFetchingNextPage, fetchNextPage])

  // Setup real-time updates for likes (adjust select if needed)
  useEffect(() => {
    if (!profile.user_id) return

    const channel = supabase.channel('profile-feed')
      .on(
        'postgres_changes' as 'system',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'likes',
        },
        // Use the imported RealtimePayload type directly
        async (payload: RealtimePayload) => { 
          const postTxid = payload.new?.post_txid
          const likeUserId = payload.new?.user_id 
          if (!postTxid || !payload.new?.txid) return

          let likerProfile = null
          if (likeUserId) {
            likerProfile = await getProfileByUserId(likeUserId)
          }

          const enrichedLike: Like & { liker_profile?: Profile | null } = {
            ...(payload.new as Like),
            ...(likerProfile ? { liker_profile: likerProfile } : {}),
          }

          ;(['new', 'top', 'liked'] as const).forEach((tabKey) => {
            queryClient.setQueryData<InfiniteData<ProfileFeedPage, number>>(
              profileQueryKeys.byTab(tabKey, profile.user_id),
              (oldData) => {
                if (!oldData?.pages || !Array.isArray(oldData.pages)) return oldData

                return {
                  ...oldData,
                  pages: oldData.pages.map((page: ProfileFeedPage) => {
                    if (!page?.data || !Array.isArray(page.data)) return page

                    return {
                      ...page,
                      data: page.data.map((post: HydratedPost) => {
                        if (post.txid !== postTxid) return post
                        const existingLikes = Array.isArray(post.likes) ? post.likes : []
                        if (existingLikes.some((like) => like.txid === payload.new?.txid)) {
                          return post
                        }
                        return {
                          ...post,
                          likes: [...existingLikes, enrichedLike],
                        }
                      }),
                    }
                  }),
                }
              }
            )
          })

          // Top feed ordering still depends on server ranking.
          queryClient.invalidateQueries({
            queryKey: profileQueryKeys.top(profile.user_id),
            exact: true,
          })
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [queryClient, profile.user_id, getProfileByUserId])

  useRealtimeUpdates<Reply>('replies', handleNewReply)

  // Setup real-time subscription for NEW posts by THIS user when 'new' tab is active
  useEffect(() => {
    // Only subscribe if the 'new' tab is active and we have a user ID
    if (activeTab !== 'new' || !profile.user_id) {
      console.log("[RT ProfileFeed] Subscription skipped (tab not 'new' or no user_id).");
      return // Do nothing if not on 'new' tab or no user ID
    }

    console.log(`[RT ProfileFeed] Attempting to subscribe for user: ${profile.user_id}`);
    const channel = supabase.channel(`profile-new-posts-${profile.user_id}`)
      .on(
        'postgres_changes' as 'system', 
        {
          event: 'INSERT',
          schema: 'public',
          table: 'posts',
          filter: `user_id=eq.${profile.user_id}` // Filter for this user's posts only
        },
        (payload: RealtimePayload) => {
          // --- Restored Original Callback Logic with Logging --- 
          console.log("[RT ProfileFeed] INSERT Payload Received:", payload);
          
          const newPostCreatedAt = payload.new?.created_at
          const isScrolledDown = window.scrollY > 0
          const currentLatestTimestamp = latestPostTimestampRef.current;

          console.log(`[RT Check] newPostCreatedAt: ${newPostCreatedAt}, isScrolledDown: ${isScrolledDown}, currentLatestTimestamp: ${currentLatestTimestamp}`);

          if (
            newPostCreatedAt &&
            (!currentLatestTimestamp || newPostCreatedAt > currentLatestTimestamp)
          ) {
            console.log("[RT ProfileFeed] Conditions met (scroll check removed), setting hasNewPosts true.");
            setHasNewPosts(true) // Show the indicator
          } else {
            // Log specific reasons why conditions failed
            let reason = "Unknown reason";
            if (!newPostCreatedAt) reason = "No newPostCreatedAt in payload";
            else if (currentLatestTimestamp && newPostCreatedAt <= currentLatestTimestamp) reason = "New post is not newer than latest displayed";
            console.log(`[RT ProfileFeed] Conditions NOT met for showing badge. Reason: ${reason}`);
          }
        }
      )
      .subscribe((status, err) => { 
          // --- ADD DETAILED STATUS LOGGING --- 
          console.log(`[RT ProfileFeed] Subscription Status: ${status}`);
          if (err) {
              console.error("[RT ProfileFeed] Subscription Error:", err);
          }
          if (status === 'SUBSCRIBED') {
            console.log("[RT ProfileFeed] Successfully subscribed!");
          } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            console.error(`[RT ProfileFeed] Subscription Problem: Status=${status}, Error=`, err);
          } else if (status === 'CLOSED') {
            console.warn("[RT ProfileFeed] Subscription closed.");
          }
      });

    // Cleanup: remove channel when tab changes or component unmounts
    return () => {
      console.log("[RT ProfileFeed] Cleaning up subscription.");
      supabase.removeChannel(channel)
        .then(status => console.log(`[RT ProfileFeed] removeChannel status: ${status}`))
        .catch(error => console.error(`[RT ProfileFeed] removeChannel error:`, error));
    }
    // Depend on supabase client, user ID, and activeTab
  }, [supabase, profile.user_id, activeTab])

  // Function to handle showing new posts
  const showNewPosts = async () => { // Make async to await refetch
    if (isShowingNewPosts) return; // Prevent double-clicks

    setIsShowingNewPosts(true);
    setHasNewPosts(false); // Hide the indicator immediately
    window.scrollTo({ top: 0, behavior: 'smooth' });

    console.log("Refetching 'user-posts' query...");
    try {
        // Invalidate the query to refetch posts including the new ones
        const refetchResult = await queryClient.refetchQueries({
          queryKey: profileQueryKeys.new(profile.user_id),
          exact: true,
        });
        console.log("Refetch completed.");
        // *** ADDED LOG ***
        // Access the query state AFTER refetch to see the data
        const updatedQueryData = queryClient.getQueryData<InfiniteData<ProfileFeedPage, number>>(
          profileQueryKeys.new(profile.user_id)
        );
        console.log("Data after refetch:", updatedQueryData);
        const firstPagePosts = updatedQueryData?.pages?.[0]?.data;
        if (firstPagePosts && firstPagePosts.length > 0) {
          console.log("First post profile data:", firstPagePosts[0]?.profile);
          console.log("First post likes:", firstPagePosts[0]?.likes);
        }
    } catch (error) {
        console.error("Error refetching user posts:", error);
        // Optionally reset hasNewPosts if fetch fails?
        // setHasNewPosts(true); 
    } finally {
        setIsShowingNewPosts(false); // Hide spinner regardless of success/failure
    }
  }

  // Click handler for the 'New' tab trigger
  const handleNewTabClick = () => {
      if (activeTab === 'new' && hasNewPosts) {
          showNewPosts(); // Call the refresh logic if needed
      }
      // Note: The Tabs component's onValueChange will still handle the actual tab switch
  };

  // Function to handle order click
  const handleOrderClick = (price: number, amount: number, orderType: 'buy' | 'sell') => {
    const actualAmount = amount * 1000
    setTradeAmount(actualAmount.toString())
    setSelectedPrice(price)
    setTradeMode(orderType === 'buy' ? 'sell' : 'buy')
  }

  return (
    <div className="font-sans pb-24 lg:pb-0">
      {/* Conditional rendering based on showMarketplace */}
      {showMarketplace ? (
        <div className="bg-background rounded-lg shadow-sm border border-border/40 overflow-hidden mt-4">
          <div className="border-b border-border/40 p-4 flex justify-between items-center">
            <h2 className="text-lg font-semibold">
              <span className="font-mono text-primary">${profile.username || 'user'}</span> / sats
            </h2>
            <div className="flex items-center space-x-2">
              <span className="text-sm px-3 py-1 rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 font-medium">
                +5.2%
              </span>
            </div>
          </div>
          
          <div className="p-6">
            {/* Token stats cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <div className="bg-background rounded-lg border border-border/40 p-3 shadow-sm">
                <div className="text-xs text-muted-foreground mb-1">Current Price</div>
                <div className="text-xl font-semibold">4.2K sats</div>
              </div>
              <div className="bg-background rounded-lg border border-border/40 p-3 shadow-sm">
                <div className="text-xs text-muted-foreground mb-1">Market Cap</div>
                <div className="text-xl font-semibold">4.2M sats</div>
              </div>
              <div className="bg-background rounded-lg border border-border/40 p-3 shadow-sm">
                <div className="text-xs text-muted-foreground mb-1">Holders</div>
                <div className="text-xl font-semibold">24</div>
              </div>
              <div className="bg-background rounded-lg border border-border/40 p-3 shadow-sm">
                <div className="text-xs text-muted-foreground mb-1">Supply</div>
                <div className="text-xl font-semibold">1,000</div>
              </div>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Trading options */}
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="text-sm font-medium">Trading</h3>
                  <span className="text-xs text-muted-foreground">24h Volume: 120K sats</span>
                </div>
                
                {/* User balance card */}
                <div className="bg-background rounded-lg border border-border/40 p-3 shadow-sm mb-3">
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="text-xs text-muted-foreground">Your Balance</div>
                      <div className="text-lg font-semibold mt-0.5">1.2M sats</div>
                    </div>
                    <button className="text-xs bg-primary/10 text-primary hover:bg-primary/20 px-2.5 py-1 rounded-full transition-colors">
                      Deposit
                    </button>
                  </div>
                </div>
                
                <div className="bg-background rounded-lg border border-border/40 p-4 shadow-sm">
                  <div className="flex mb-4 p-1 bg-muted/40 rounded-lg">
                    <button 
                      className={`flex-1 py-2 px-4 rounded-md font-medium text-sm transition-all duration-200 flex items-center justify-center ${
                        tradeMode === 'buy' 
                          ? 'bg-primary text-primary-foreground shadow-sm' 
                          : 'text-muted-foreground hover:bg-muted/60'
                      }`}
                      onClick={() => setTradeMode('buy')}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1.5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M3.293 9.707a1 1 0 010-1.414l6-6a1 1 0 011.414 0l6 6a1 1 0 01-1.414 1.414L11 5.414V17a1 1 0 11-2 0V5.414L4.707 9.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                      </svg>
                      Buy
                    </button>
                    <button 
                      className={`flex-1 py-2 px-4 rounded-md font-medium text-sm transition-all duration-200 flex items-center justify-center ${
                        tradeMode === 'sell' 
                          ? 'bg-primary text-primary-foreground shadow-sm' 
                          : 'text-muted-foreground hover:bg-muted/60'
                      }`}
                      onClick={() => setTradeMode('sell')}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1.5" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 10.293a1 1 0 010 1.414l-6 6a1 1 0 01-1.414 0l-6-6a1 1 0 111.414-1.414L9 14.586V3a1 1 0 012 0v11.586l4.293-4.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      Sell
                    </button>
                  </div>
                  
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Amount (tokens)</span>
                      <div className="relative w-2/3">
                        <input 
                          type="number" 
                          className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-base shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" 
                          placeholder="0.00"
                          value={tradeAmount}
                          onChange={(e) => setTradeAmount(e.target.value)}
                        />
                        <div className="absolute inset-y-0 right-0 flex items-center pr-3 pointer-events-none text-xs text-muted-foreground">
                          ${profile.username || 'user'}
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Price per token</span>
                      <div className="text-sm font-medium font-mono">
                        {selectedPrice ? `${selectedPrice.toLocaleString()} sats` : "Market price"}
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Total Cost</span>
                      <div className="text-sm font-medium">
                        {selectedPrice && tradeAmount 
                          ? `${(parseInt(tradeAmount) * selectedPrice).toLocaleString()} sats` 
                          : "42,000 sats"}
                      </div>
                    </div>
                    
                    <button className={`w-full py-2.5 rounded-md font-medium mt-2 transition-colors shadow-sm hover:shadow flex items-center justify-center ${
                      tradeMode === 'buy'
                        ? 'bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white'
                        : 'bg-gradient-to-r from-red-500 to-rose-600 hover:from-red-600 hover:to-rose-700 text-white'
                    }`}>
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1.5" viewBox="0 0 20 20" fill="currentColor">
                        {tradeMode === 'buy' ? (
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z" clipRule="evenodd" />
                        ) : (
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM7 9a1 1 0 000 2h6a1 1 0 100-2H7z" clipRule="evenodd" />
                        )}
                      </svg>
                      {tradeMode === 'buy' ? `Buy $${profile.username || 'user'}` : `Sell $${profile.username || 'user'}`}
                    </button>
                  </div>
                </div>
              </div>
              
              {/* Order book */}
              <div className="space-y-4">
                <h3 className="text-sm font-medium">Order Book</h3>
                
                <div className="bg-background rounded-lg border border-border/40 p-4 shadow-sm">
                  {/* Buy orders */}
                  <div className="space-y-1 mb-4">
                    <div className="flex justify-between text-xs text-muted-foreground pb-2 border-b border-border/40">
                      <span>Buy Orders</span>
                      <span>Amount</span>
                    </div>
                    {buyOrders.map((order, i) => (
                      <div 
                        key={`buy-${i}`} 
                        className="flex justify-between text-sm py-1.5 hover:bg-muted/30 rounded px-1.5 cursor-pointer transition-colors"
                        onClick={() => handleOrderClick(order.price, order.amount, 'buy')}
                      >
                        <span className="text-green-600 dark:text-green-500 font-mono">{order.price.toLocaleString()} sats</span>
                        <span className="font-medium">{order.amount}K</span>
                      </div>
                    ))}
                  </div>
                  
                  {/* Current price indicator */}
                  <div className="flex justify-between items-center py-2 px-2 my-2 bg-muted/30 rounded-md text-sm border-l-4 border-primary">
                    <span className="text-muted-foreground">Current Price</span>
                    <span className="font-medium font-mono">4,200 sats</span>
                  </div>
                  
                  {/* Sell orders */}
                  <div className="space-y-1 mt-4">
                    <div className="flex justify-between text-xs text-muted-foreground pb-2 border-b border-border/40">
                      <span>Sell Orders</span>
                      <span>Amount</span>
                    </div>
                    {sellOrders.map((order, i) => (
                      <div 
                        key={`sell-${i}`} 
                        className="flex justify-between text-sm py-1.5 hover:bg-muted/30 rounded px-1.5 cursor-pointer transition-colors"
                        onClick={() => handleOrderClick(order.price, order.amount, 'sell')}
                      >
                        <span className="text-red-600 dark:text-red-500 font-mono">{order.price.toLocaleString()} sats</span>
                        <span className="font-medium">{order.amount}K</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Tabs */}
          <div className="bg-inherit backdrop-blur supports-[backdrop-filter]:bg-inherit border-b border-border/60">
            <div className="flex flex-col px-3 py-2 sm:px-4 max-w-2xl mx-auto">
              <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as FeedType)}>
                <TabsList className="mx-auto grid w-full max-w-[400px] grid-cols-2 rounded-full border border-border/60 bg-background/60 p-1 backdrop-blur">
                  <TabsTrigger
                    value="new"
                    onClick={handleNewTabClick}
                    className="relative rounded-full text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground transition-colors data-[state=active]:bg-amber-400/15 data-[state=active]:text-amber-600 data-[state=active]:shadow-none dark:data-[state=active]:text-amber-300"
                  >
                    {isShowingNewPosts ? (
                      <Loader2 className="h-4 w-4 animate-spin mx-auto" />
                    ) : (
                      "New"
                    )}
                    {!isShowingNewPosts && hasNewPosts && (
                      <span
                        title="Show new posts"
                        className="absolute top-1 right-1 h-2.5 w-2.5 rounded-full bg-amber-400 animate-pulse shadow-[0_0_10px_2px_rgba(245,158,11,0.5)]"
                        aria-label="Show new posts"
                      />
                    )}
                  </TabsTrigger>
                  <TabsTrigger
                    value="top"
                    className="rounded-full text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground transition-colors data-[state=active]:bg-amber-400/15 data-[state=active]:text-amber-600 data-[state=active]:shadow-none dark:data-[state=active]:text-amber-300"
                  >
                    Top
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>

          {/* Posts */}
          <div className="">
            {/* === Conditional Rendering Logic using status === */}
            {status === 'pending' ? (
              // 1. Initial Load: Show spinner when status is 'pending'
              <div className="flex flex-col justify-center items-center py-16 gap-3">
                <Loader2 className="h-8 w-8 animate-spin text-amber-500 dark:text-amber-400" />
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Loading posts…</p>
              </div>
            ) : status === 'error' ? (
              // 2. Error State: Show an error message
              <div className="mx-4 mt-4 flex flex-col items-center justify-center py-8 rounded-2xl border border-destructive/30 bg-destructive/5 backdrop-blur text-destructive">
                Error loading posts. Please try again later.
              </div>
            ) : posts?.length === 0 ? (
              // 3. Empty State: Show message only if status is 'success' and no posts
              <div className="mx-4 mt-4 flex flex-col items-center justify-center py-10 rounded-2xl border border-border/60 bg-background/60 backdrop-blur text-center">
                <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  {activeTab === "new" ? "No posts yet" : "No satoshis locked to posts yet"}
                </div>
              </div>
            ) : (
              // 4. Posts Exist: Show posts (status === 'success' and posts.length > 0)
              <>
                {posts?.map((post: HydratedPost) => (
                  <Post key={post.txid} post={post} blockHeight={currentBlockHeight} />
                ))}

                <div ref={observerTarget} className="h-4" />

                {isFetchingNextPage && (
                  <div className="py-3 flex justify-center">
                    <Loader2 className="h-4 w-4 animate-spin text-amber-500 dark:text-amber-400" />
                  </div>
                )}


              </>
            )}
          </div>
        </>
      )}
    </div>
  )
} 