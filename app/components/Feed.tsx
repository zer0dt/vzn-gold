'use client'

import { useEffect, useState, useRef, useMemo, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/utils/supabase/client'
import { Loader2 } from "lucide-react"
import { Tabs, TabsList, TabsTrigger } from "@/app/components/ui/tabs"
import { useInfiniteQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { useBlockHeightContext } from '@/app/contexts/BlockHeightContext'
import dynamic from 'next/dynamic'

import { cn } from '@/app/lib/utils'
import type { Post, Like, Reply, Profile } from '@/types'
import { PostSkeleton } from "./PostSkeleton"
import { useAuth } from '@/app/contexts/AuthContext'
import type { PostProps } from './Post/index'
import { useRealtimeUpdates } from '@/app/hooks/useRealtimeUpdates'
import {
  TOP_TIME_PERIODS,
  feedQueryKeys,
  type MainFeedTimePeriod,
  type MainFeedType,
} from '@/app/lib/query-keys'
import {
  consumeOptimisticReply,
  fetchMainFeedPosts,
  MAIN_FEED_PAGE_SIZE,
  prependPostToInfiniteData,
  syncReplyCountAcrossPostCaches,
  type HydratedPost,
} from '@/app/lib/supabase/posts'
import { getProfileByUserId as fetchProfileByUserId } from '@/app/lib/supabase/profiles'

const supabase = createClient()

type FeedType = MainFeedType
type TimePeriod = MainFeedTimePeriod

const NEW_FEED_QUERY_KEY = feedQueryKeys.new()

const feedTabsListClassName =
  "vzn-app-background isolate rounded-full border border-border/35 p-1 shadow-none"

const feedTabsTriggerClassName =
  "relative rounded-full font-medium uppercase text-muted-foreground tracking-[0.12em] transition-[background-color,color,box-shadow] duration-200 ease-out hover:bg-primary/5 hover:text-foreground focus-visible:ring-amber-400/35 data-[state=active]:bg-primary/10 data-[state=active]:text-amber-700 data-[state=active]:shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.28)] dark:data-[state=active]:bg-primary/12 dark:data-[state=active]:text-amber-200"

const getPostsQueryKey = (
  feedType: FeedType,
  timePeriod: TimePeriod
) => feedQueryKeys.byType(feedType, timePeriod)

const fetchPosts = async (
  type: FeedType,
  blockHeight: number,
  timePeriod?: TimePeriod,
  page = 0
) =>
  fetchMainFeedPosts(supabase, {
    feedType: type,
    blockHeight,
    timePeriod: timePeriod ?? 'all',
    page,
  })

const FeedPost = dynamic<{ post: PostProps['post']; blockHeight: number; showDivider?: boolean }>(() => import('./Post/index').then((mod) => mod.Post), {
  loading: () => <PostSkeleton />
})

export default function Feed() {
  const searchParams = useSearchParams()
  const initialTab: FeedType = searchParams?.get('tab') === 'top' ? 'top' : 'new'
  const [activeTab, setActiveTab] = useState<FeedType>(initialTab)
  const [timePeriod, setTimePeriod] = useState<TimePeriod>("24h")
  const { blockHeight: currentBlockHeight } = useBlockHeightContext()
  const queryClient = useQueryClient()
  const { user } = useAuth()

  const [newPostsCount, setNewPostsCount] = useState(0)
  const [isRefreshingNewFeed, setIsRefreshingNewFeed] = useState(false)

  const activeTabRef = useRef(activeTab)
  const previousActiveTabRef = useRef<FeedType | null>(null)
  const profileCacheRef = useRef<Map<string, Profile>>(new Map())

  const getProfileByUserId = useCallback(
    async (userId: string | null | undefined, fallbackUsername = 'Anon') => {
      return fetchProfileByUserId(supabase, userId, {
        cache: profileCacheRef.current,
        fallbackUsername,
      })
    },
    []
  );

  useEffect(() => {
    activeTabRef.current = activeTab
  }, [activeTab])

  useEffect(() => {
    if (activeTab !== 'new') {
      setNewPostsCount(0)
    }
  }, [activeTab])

  useEffect(() => {
    if (activeTab === 'new' && previousActiveTabRef.current !== 'new' && previousActiveTabRef.current !== null) {
      queryClient.refetchQueries({ queryKey: NEW_FEED_QUERY_KEY, exact: true })
    }
    previousActiveTabRef.current = activeTab
  }, [activeTab, queryClient])

  const postsQueryKey = useMemo(
    () => getPostsQueryKey(activeTab, timePeriod),
    [activeTab, timePeriod]
  )

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isFetching,
  } = useInfiniteQuery({
    queryKey: postsQueryKey,
    queryFn: ({ pageParam = 0 }): Promise<HydratedPost[]> =>
      fetchPosts(activeTab, currentBlockHeight, timePeriod, pageParam as number),
    getNextPageParam: (lastPage, _allPages, lastPageParam): number | undefined => {
      const page = lastPageParam as number
      return lastPage && lastPage.length === MAIN_FEED_PAGE_SIZE ? page + 1 : undefined
    },
    initialPageParam: 0 as number,
    staleTime: 1000 * 60 * 1,
    gcTime: 1000 * 60 * 5,
    enabled: !!currentBlockHeight || activeTab === 'new',
  })

  const posts: HydratedPost[] = useMemo(() => {
    const flatPosts = data?.pages.flat().filter((post): post is HydratedPost => !!post) ?? []
    const seenTxids = new Set<string>()
    const uniquePosts = flatPosts.filter((post: HydratedPost) => {
      if (post?.txid && !seenTxids.has(post.txid)) {
        seenTxids.add(post.txid)
        return true
      }
      return false
    })
    return uniquePosts
  }, [data?.pages])

  const observerTarget = useRef<HTMLDivElement>(null)

  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const pullRafRef = useRef<number | null>(null);
  const pendingPullDistanceRef = useRef(0);
  const lastAppliedPullDistanceRef = useRef(0);

  const [isPulling, setIsPulling] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const touchStartY = useRef<number>(0);
  const PULL_THRESHOLD = 70; // Minimum pull distance to trigger refresh
  const MIN_REFRESH_TIME = 800; // Minimum time to show spinner (ms)

  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const target = entries[0]
      if (target.isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage()
      }
    },
    [fetchNextPage, hasNextPage, isFetchingNextPage]
  )

  useEffect(() => {
    const rootContainer = scrollContainerRef.current;
    const observer = new IntersectionObserver(handleObserver, {
      root: rootContainer, // observe against the feed scroll container
      rootMargin: '0px 0px 800px 0px', // Increase bottom margin substantially
      threshold: 0.1 // Trigger when 10% visible
    })
    const currentTarget = observerTarget.current

    if (currentTarget) {
      observer.observe(currentTarget)
    }

    return () => {
      if (currentTarget) {
        observer.unobserve(currentTarget)
      }
    }
  }, [handleObserver])

  useEffect(() => {
    return () => {
      if (pullRafRef.current != null) {
        cancelAnimationFrame(pullRafRef.current);
        pullRafRef.current = null;
      }
    };
  }, []);


  const handleNewPost = useCallback(async (newPost: Post) => {
    const isCurrentUserPost = user?.id === newPost.user_id;
    const currentFeedData = queryClient.getQueryData<InfiniteData<HydratedPost[], number>>(NEW_FEED_QUERY_KEY);
    const isAlreadyPresent = currentFeedData?.pages.flat().some((post) => post.txid === newPost.txid);

    if (isAlreadyPresent) {
      return;
    }

    if (!isCurrentUserPost && activeTabRef.current !== 'new') {
      setNewPostsCount((prev) => prev + 1);
      return;
    }

    const profile = await getProfileByUserId(newPost.user_id, isCurrentUserPost ? 'You' : 'Anon');
    const enrichedPost = {
      ...newPost,
      profile,
      profiles: profile,
    } as HydratedPost;

    queryClient.setQueryData<InfiniteData<HydratedPost[], number>>(NEW_FEED_QUERY_KEY, (oldData) =>
      prependPostToInfiniteData(oldData, enrichedPost)
    );

    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [queryClient, user, getProfileByUserId]);

  const handleNewLike = useCallback(async (newLike: Like) => {
    const likerProfile = await getProfileByUserId(newLike.user_id, 'Anon');

    // Create the enriched object BEFORE updating the cache
    const enrichedLike = {
      ...newLike,
      liker_profile: likerProfile // Attach the fetched or default profile
    };
    // For NEW feeds, we can safely update the cache manually.
    // For TOP feeds, we invalidate because ranking is server-side.
    const queryKeysToUpdate = [NEW_FEED_QUERY_KEY];

    // Update cache for NEW and SUPER feeds
    queryKeysToUpdate.forEach(queryKey => {
      queryClient.setQueryData<InfiniteData<HydratedPost[], number>>(queryKey, (oldData) => {
        if (!oldData) return undefined;

        const newData: InfiniteData<HydratedPost[], number> = {
          ...oldData,
          pages: oldData.pages.map((page) =>
            Array.isArray(page) ? page.map((post: HydratedPost) => {
              if (post.txid === enrichedLike.post_txid) {
                 const existingLikes = post.likes || [];
                 const updatedLikes = existingLikes.some(l => l.txid === enrichedLike.txid)
                    ? existingLikes
                    : [...existingLikes, enrichedLike]; // Use enriched like with profile data
                 return { ...post, likes: updatedLikes }; // Return updated post
              }
              return post; // Return unchanged post
            }) : page // Return non-array page as is
          ),
        };

        return newData;
      });
    });

    // For TOP feed, invalidate all time periods to ensure proper server-side filtering
    const topFeedQueryKeys = TOP_TIME_PERIODS.map((period) =>
      getPostsQueryKey('top', period)
    );

    topFeedQueryKeys.forEach(queryKey => {
      queryClient.invalidateQueries({ queryKey, exact: true });
    });

  }, [queryClient, getProfileByUserId]);

  const handleNewReply = useCallback(async (newReply: Reply) => {
    const wasOptimisticReply = consumeOptimisticReply(newReply.txid);
    const replierProfile = await getProfileByUserId(newReply.user_id, 'Anon');
    
    const enrichedReply = {
      ...newReply,
      profile: replierProfile || { username: null, avatar_url: null }
    };
    
    // Update the replies cache for this post (for when CommentSheet is open)
    // Track if this is a new reply or already exists (from optimistic update)
    let replyWasNew = false;
    
    queryClient.setQueryData<Reply[]>(['replies', newReply.post_txid], (oldData) => {
      const currentReplies = oldData || [];
      // Check if reply already exists to prevent duplicates
      if (currentReplies.some((reply) => reply.txid === newReply.txid)) {
        // Reply already exists (likely from optimistic update in CommentSheet)
        return currentReplies;
      }
      replyWasNew = true;
      return [...currentReplies, enrichedReply];
    });

    // Only increment reply_count if the reply was actually new (not from optimistic update)
    if (wasOptimisticReply || !replyWasNew) {
      return; // Exit early - don't increment count
    }

    syncReplyCountAcrossPostCaches(queryClient, newReply.post_txid);
  }, [queryClient, getProfileByUserId]);

  useRealtimeUpdates<Post>('posts', handleNewPost);
  useRealtimeUpdates<Like>('likes', handleNewLike);
  useRealtimeUpdates<Reply>('replies', handleNewReply);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (scrollContainerRef.current?.scrollTop === 0 && !isRefreshing) {
      touchStartY.current = e.touches[0].clientY;
      pendingPullDistanceRef.current = 0;
      lastAppliedPullDistanceRef.current = 0;
    }
  }, [isRefreshing]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!scrollContainerRef.current || isRefreshing) return;
    
    const scrollTop = scrollContainerRef.current.scrollTop;
    if (scrollTop > 0) {
      // Not at top, reset pull state
      if (isPulling) {
        setIsPulling(false);
        setPullDistance(0);
      }
      return;
    }

    const touchY = e.touches[0].clientY;
    const diff = touchY - touchStartY.current;
    
    if (diff > 10) { // Small threshold to prevent accidental triggers
      // Pulling down at top of scroll
      setIsPulling(true);
      // Apply resistance - diminishing returns as you pull further
      const resistance = Math.max(0.3, 1 - diff / 500);
      const nextDistance = Math.min(diff * resistance, PULL_THRESHOLD * 1.8);
      if (Math.abs(nextDistance - lastAppliedPullDistanceRef.current) < 1) return;

      pendingPullDistanceRef.current = nextDistance;
      if (pullRafRef.current != null) return;

      pullRafRef.current = requestAnimationFrame(() => {
        pullRafRef.current = null;
        lastAppliedPullDistanceRef.current = pendingPullDistanceRef.current;
        setPullDistance(pendingPullDistanceRef.current);
      });
    }
  }, [isRefreshing, isPulling]);

  const handleTouchEnd = useCallback(async () => {
    if (!isPulling) return;
    
    if (pullDistance >= PULL_THRESHOLD && !isRefreshing) {
      // Trigger refresh - keep pull indicator visible
      setIsRefreshing(true);
      setPullDistance(PULL_THRESHOLD); // Lock at threshold position
      setIsPulling(false);

      const refreshStartTime = Date.now();
      
      try {
        await queryClient.refetchQueries({ queryKey: postsQueryKey, exact: true });
        
        // Reset new posts count if on 'new' tab
        if (activeTab === 'new') {
          setNewPostsCount(0);
        }
      } catch (error) {
        console.error("[Pull-to-Refresh] Error:", error);
      }
      
      // Ensure minimum visible time for spinner
      const elapsed = Date.now() - refreshStartTime;
      const remainingTime = Math.max(0, MIN_REFRESH_TIME - elapsed);
      
      await new Promise(resolve => setTimeout(resolve, remainingTime));
      
      // Smoothly animate out
      setIsRefreshing(false);
      setPullDistance(0);
      lastAppliedPullDistanceRef.current = 0;
    } else {
      // Not past threshold - smoothly reset
      setIsPulling(false);
      setPullDistance(0);
      lastAppliedPullDistanceRef.current = 0;
    }
  }, [isPulling, pullDistance, isRefreshing, postsQueryKey, activeTab, queryClient]);

  const previousBlockHeightRef = useRef<number>(0);

  useEffect(() => {
    if (currentBlockHeight > 0 && currentBlockHeight !== previousBlockHeightRef.current) {
      queryClient.invalidateQueries({
        queryKey: ['posts', 'top'],
        refetchType: 'all',
      });
      previousBlockHeightRef.current = currentBlockHeight;
    }
  }, [currentBlockHeight, queryClient]);

  const showLoadingSkeleton =
    isLoading &&
    !(data as InfiniteData<HydratedPost[], number> | undefined)?.pages?.length;

  useEffect(() => {
    const shouldScroll = scrollContainerRef.current && activeTab === 'top';

    if (shouldScroll) {
      const timerId = setTimeout(() => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTo({ top: 0, behavior: 'smooth' });
        }
      }, 500);

      return () => clearTimeout(timerId);
    }
  }, [activeTab, timePeriod]);

  // Helper mapping for time period text
  const timePeriodTextMap: { [key in typeof timePeriod]: string } = {
    "24h": "today",
    "week": "this week",
    "month": "this month",
    "year": "this year",
    "all": "all time"
  };

  const handleTabChange = (value: string) => {
    const newTab = value as FeedType
    setActiveTab(newTab)
  }

  const handleNewTabClick = async () => {
    if (activeTab === 'new' && newPostsCount > 0) {
      setNewPostsCount(0)
      setIsRefreshingNewFeed(true)

      try {
        await queryClient.refetchQueries({ queryKey: NEW_FEED_QUERY_KEY, exact: true })
        scrollContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
      } catch (error) {
        console.error("Error refetching 'new' feed:", error)
      } finally {
        setIsRefreshingNewFeed(false)
      }
    }
  }

  return (
    <div className="relative lg:pt-0 -mt-2 bg-transparent">
      {/* --- Mobile Floating Tabs Header --- */}
      <div className="fixed top-2 left-1/2 transform -translate-x-1/2 z-40 block lg:hidden w-full px-3 pointer-events-none"> {/* Make parent full width and disable its pointer events */}

        {/* Tabs Container (Rendered first) with frosted tabs only (no full-width bg) */}
        <div className="w-full">
          {/* Make this container allow pointer events */}
          <div className="w-fit max-w-[calc(100vw-2rem)] mx-auto px-4 py-0.5 bg-transparent border-0 rounded-none shadow-none pointer-events-auto">
          {/* Inner container for flex layout of tabs */}
          <div className="flex flex-col items-center space-y-1">
            {/* Main Feed Tabs */}
            <Tabs value={activeTab} onValueChange={handleTabChange}>
              <TabsList className={cn(feedTabsListClassName, "flex gap-1")}>
                 <TabsTrigger
                   value="new"
                   onClick={handleNewTabClick}
                   className={cn(feedTabsTriggerClassName, "px-4 py-1.5 text-xs")}
                 >
                   <span className="flex items-center gap-1.5">
                     {(isRefreshingNewFeed || (isRefreshing && activeTab === 'new')) ? (
                       <Loader2 className="h-4 w-4 animate-spin" />
                     ) : (
                       "New"
                     )}
                     {newPostsCount > 0 && !isRefreshingNewFeed && !isRefreshing && (
                       <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                     )}
                   </span>
                 </TabsTrigger>
                 <TabsTrigger
                   value="top"
                   className={cn(feedTabsTriggerClassName, "px-4 py-1.5 text-xs")}
                 >
                   {isRefreshing && activeTab === 'top' ? (
                     <Loader2 className="h-4 w-4 animate-spin" />
                   ) : (
                    "Top"
                   )}
                 </TabsTrigger>
              </TabsList>
            </Tabs>
            
            {/* Add Time Period Tabs for Top Feed on Mobile */}
            {activeTab === "top" && (
              <Tabs value={timePeriod} onValueChange={(value) => setTimePeriod(value as "24h" | "week" | "month" | "year" | "all")}>
                <TabsList className={cn(feedTabsListClassName, "mt-1 flex gap-0.5")}>
                  {[
                    { value: '24h', label: 'day' },
                    { value: 'week', label: 'week' },
                    { value: 'month', label: 'month' },
                    { value: 'year', label: 'year' },
                    { value: 'all', label: 'all' },
                  ].map((tp) => (
                    <TabsTrigger
                      key={tp.value}
                      value={tp.value}
                      className={cn(feedTabsTriggerClassName, "px-2.5 py-1 text-[10px] tracking-[0.14em]")}
                    >
                      {tp.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            )}
          </div>
        </div>
        </div>
      </div>

      {/* --- Desktop Sticky Header (TABS ONLY) --- */}
      <div className="vzn-app-background sticky top-0 z-40 hidden border-b border-border/30 lg:block">

        {/* Container for tabs */}
        <div className="flex flex-col px-3 pt-3 pb-2 sm:px-4 space-y-1 max-w-4xl mx-auto">
          {/* Main Feed Tabs */}
          <Tabs value={activeTab} onValueChange={handleTabChange}>
             <TabsList className={cn(feedTabsListClassName, "mx-auto grid w-full max-w-[420px] grid-cols-2")}>
               <TabsTrigger
                 value="new"
                 onClick={handleNewTabClick}
                 className={cn(feedTabsTriggerClassName, "text-xs")}
               >
                 <span className="flex items-center gap-1.5">
                   {(isRefreshingNewFeed || (isRefreshing && activeTab === 'new')) ? (
                     <Loader2 className="h-4 w-4 animate-spin" />
                   ) : (
                     "New"
                   )}
                   {newPostsCount > 0 && !isRefreshingNewFeed && !isRefreshing && (
                     <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                   )}
                 </span>
               </TabsTrigger>
               <TabsTrigger
                 value="top"
                 className={cn(feedTabsTriggerClassName, "text-xs")}
               >
                 {isRefreshing && activeTab === 'top' ? (
                   <Loader2 className="h-4 w-4 animate-spin" />
                 ) : (
                  "Top"
                 )}
               </TabsTrigger>
             </TabsList>
           </Tabs>

           {activeTab === "top" && (
              <Tabs value={timePeriod} onValueChange={(value) => setTimePeriod(value as "24h" | "week" | "month" | "year" | "all")}>
               <TabsList className={cn(feedTabsListClassName, "mx-auto grid w-full max-w-[420px] grid-cols-5")}>
                  {[
                    { value: '24h', label: 'day' },
                    { value: 'week', label: 'week' },
                    { value: 'month', label: 'month' },
                    { value: 'year', label: 'year' },
                    { value: 'all', label: 'all' },
                  ].map((tp) => (
                    <TabsTrigger
                      key={tp.value}
                      value={tp.value}
                      className={cn(feedTabsTriggerClassName, "text-[11px] tracking-[0.14em]")}
                    >
                      {tp.label}
                    </TabsTrigger>
                  ))}
               </TabsList>
             </Tabs>
           )}
        </div>
      </div>

      <div
        ref={scrollContainerRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className={`relative z-30 h-dvh overflow-y-scroll pb-16 lg:h-screen lg:pb-0 ${
          activeTab === "top" ? "pt-24" : "pt-14"
        } lg:pt-0 mb-0 scrollbar-hide`}
      >
        {showLoadingSkeleton ? (
          Array.from({ length: 9 }).map((_, i) => (
            <PostSkeleton key={`skel-${i}`} delayMs={i * 100} />
          ))
        ) : (
          <>
            <div className="divide-y divide-border">
              {posts?.map((post: HydratedPost) => (
                <FeedPost
                  key={post.txid}
                  post={post}
                  blockHeight={currentBlockHeight}
                  showDivider={false}
                />
              ))}
            </div>

            {/* Observer Target and Loaders */}
            <div ref={observerTarget} className="h-2 lg:h-10" />

            {isFetchingNextPage && (
              <div className="py-4 flex justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            )}


             {isFetching && !isFetchingNextPage && !showLoadingSkeleton && posts?.length > 0 && (
                 <div className="py-4 flex justify-center">
                     <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                 </div>
              )}

             {!isLoading && !isFetching && !posts?.length && (
                <div className="mx-4 mt-4 flex flex-col items-center justify-center py-10 rounded-2xl border border-border/60 bg-background/60 backdrop-blur text-center">
                   <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                     {activeTab === 'new' && newPostsCount > 0
                       ? "Click the button above to show new posts"
                       : activeTab === 'top'
                        ? (timePeriod === '24h'
                           ? "No satoshis locked to posts created today"
                           : `No satoshis locked to posts ${timePeriodTextMap[timePeriod]}`)
                        : "No posts found for this feed"
                     }
                   </div>
                </div>
             )}
           </>
         )}
      </div>
      
    </div>
  )
} 