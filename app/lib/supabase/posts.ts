import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import type { SupabaseClient } from '@supabase/supabase-js'

import type { Like, Post, Profile } from '@/types'
import type {
  MainFeedType,
  MainFeedTimePeriod,
  ProfileFeedType,
} from '@/app/lib/query-keys'
import { singlePostQueryKeys } from '@/app/lib/query-keys'
import { buildFallbackProfile } from '@/app/lib/supabase/profiles'

export type HydratedPost = Post & {
  profile?: Profile | null
  hasImage?: boolean
  likes?: Array<Like & { liker_profile?: Profile | null }>
}

export type ProfileFeedPage = {
  data: HydratedPost[]
  nextPage: number | null
}

type HydratedLike = NonNullable<HydratedPost['likes']>[number]

const optimisticReplyCleanupTimers = new Map<string, ReturnType<typeof setTimeout>>()

export const MAIN_FEED_PAGE_SIZE = 5
const PROFILE_FEED_LIMIT = 10

const NEW_FEED_SELECT = `
  *,
  profile:profiles!posts_user_id_fkey!left(user_id, username, avatar_url, cover_url, created_at, updated_at),
  likes!left (
    *,
    liker_profile:profiles!likes_user_id_fkey!left(user_id, username, avatar_url, cover_url, created_at, updated_at)
  ),
  replies(count)
`

const SINGLE_POST_SELECT = `
  *,
  likes!left(
    *,
    liker_profile:profiles!likes_user_id_fkey(
      user_id,
      username,
      avatar_url,
      cover_url,
      created_at,
      updated_at
    )
  ),
  profile:profiles!posts_user_id_fkey(
    user_id,
    username,
    avatar_url,
    cover_url,
    created_at,
    updated_at
  ),
  replies(count)
`

function getTimeCutoff(timePeriod: MainFeedTimePeriod): string {
  const now = new Date()
  const timeFilters: Record<MainFeedTimePeriod, Date> = {
    '24h': new Date(now.getTime() - 24 * 60 * 60 * 1000),
    week: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
    month: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
    year: new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000),
    all: new Date(0),
  }

  return timeFilters[timePeriod].toISOString()
}

function normalizeLikes(likes: unknown): Array<Like & { liker_profile?: Profile | null }> {
  if (!Array.isArray(likes)) {
    return []
  }

  return likes
    .filter((like): like is Record<string, any> => Boolean(like))
    .map((like) => ({
      ...like,
      liker_profile: like.liker_profile ?? like.profiles ?? null,
    })) as Array<Like & { liker_profile?: Profile | null }>
}

export function normalizePostRow(post: Record<string, any>): HydratedPost {
  const profile = post.profile ?? post.profiles ?? buildFallbackProfile(post.user_id, 'Anon')
  const replyCount =
    Array.isArray(post.replies) && post.replies[0]?.count != null
      ? post.replies[0].count
      : post.reply_count ?? 0

  return {
    ...post,
    likes: normalizeLikes(post.likes),
    reply_count: replyCount,
    profile,
    profiles: profile,
    hasImage: Boolean(post.hasImage ?? post.has_image),
    has_image: Boolean(post.has_image ?? post.hasImage),
    wallet_address: post.wallet_address ?? null,
  } as HydratedPost
}

export function createOptimisticPost(params: {
  txid: string
  content: string
  userId: string
  profile: Profile
  createdAt?: string
  hasImage?: boolean
}): HydratedPost {
  return normalizePostRow({
    txid: params.txid,
    content: params.content,
    user_id: params.userId,
    wallet_address: null,
    has_image: params.hasImage ?? false,
    created_at: params.createdAt ?? new Date().toISOString(),
    likes: [],
    replies: [{ count: 0 }],
    profile: params.profile,
  })
}

export function prependPostToInfiniteData(
  oldData: InfiniteData<HydratedPost[], number> | undefined,
  post: HydratedPost
): InfiniteData<HydratedPost[], number> {
  if (!oldData) {
    return {
      pages: [[post]],
      pageParams: [0],
    }
  }

  const updatedPages = [...oldData.pages]
  if (updatedPages.length > 0 && Array.isArray(updatedPages[0])) {
    updatedPages[0] = [post, ...updatedPages[0]]
  } else {
    updatedPages.unshift([post])
  }

  return {
    ...oldData,
    pages: updatedPages,
  }
}

export function incrementReplyCountInInfiniteData(
  oldData: InfiniteData<HydratedPost[], number> | undefined,
  postTxid: string,
  delta = 1
): InfiniteData<HydratedPost[], number> | undefined {
  if (!oldData) {
    return undefined
  }

  return {
    ...oldData,
    pages: oldData.pages.map((page) =>
      Array.isArray(page)
        ? page.map((post) =>
            post.txid === postTxid
              ? { ...post, reply_count: (post.reply_count ?? 0) + delta }
              : post
          )
        : page
    ),
  }
}

export function incrementReplyCountInProfileFeedData(
  oldData: InfiniteData<ProfileFeedPage, number> | undefined,
  postTxid: string,
  delta = 1
): InfiniteData<ProfileFeedPage, number> | undefined {
  if (!oldData) {
    return undefined
  }

  return {
    ...oldData,
    pages: oldData.pages.map((page) => ({
      ...page,
      data: Array.isArray(page.data)
        ? page.data.map((post) =>
            post.txid === postTxid
              ? { ...post, reply_count: Math.max(0, (post.reply_count ?? 0) + delta) }
              : post
          )
        : page.data,
    })),
  }
}

export function incrementReplyCountInPostData(
  oldData: HydratedPost | null | undefined,
  postTxid: string,
  delta = 1
): HydratedPost | null | undefined {
  if (!oldData || oldData.txid !== postTxid) {
    return oldData
  }

  return {
    ...oldData,
    reply_count: Math.max(0, (oldData.reply_count ?? 0) + delta),
  }
}

export function syncReplyCountAcrossPostCaches(
  queryClient: QueryClient,
  postTxid: string,
  delta = 1
) {
  queryClient.setQueriesData<InfiniteData<HydratedPost[], number>>(
    { queryKey: ['posts'] },
    (oldData) => incrementReplyCountInInfiniteData(oldData, postTxid, delta)
  )

  queryClient.setQueriesData<InfiniteData<ProfileFeedPage, number>>(
    { queryKey: ['user-posts'] },
    (oldData) => incrementReplyCountInProfileFeedData(oldData, postTxid, delta)
  )

  queryClient.setQueryData<HydratedPost | null>(
    singlePostQueryKeys.byTxid(postTxid),
    (oldData) => incrementReplyCountInPostData(oldData, postTxid, delta)
  )
}

function appendLikeToPost(
  post: HydratedPost,
  postTxid: string,
  like: HydratedLike
): HydratedPost {
  if (post.txid !== postTxid || post.likes?.some((existing) => existing.txid === like.txid)) {
    return post
  }

  return {
    ...post,
    likes: [like, ...(post.likes ?? [])],
  }
}

export function syncLikeAcrossPostCaches(
  queryClient: QueryClient,
  postTxid: string,
  like: HydratedLike
) {
  queryClient.setQueriesData<InfiniteData<HydratedPost[], number>>(
    { queryKey: ['posts'] },
    (oldData) => {
      if (!oldData) return oldData
      return {
        ...oldData,
        pages: oldData.pages.map((page) =>
          Array.isArray(page)
            ? page.map((post) => appendLikeToPost(post, postTxid, like))
            : page
        ),
      }
    }
  )

  queryClient.setQueriesData<InfiniteData<ProfileFeedPage, number>>(
    { queryKey: ['user-posts'] },
    (oldData) => {
      if (!oldData) return oldData
      return {
        ...oldData,
        pages: oldData.pages.map((page) => ({
          ...page,
          data: page.data.map((post) => appendLikeToPost(post, postTxid, like)),
        })),
      }
    }
  )

  queryClient.setQueryData<HydratedPost | null>(
    singlePostQueryKeys.byTxid(postTxid),
    (oldData) => oldData ? appendLikeToPost(oldData, postTxid, like) : oldData
  )
}

export function registerOptimisticReply(txid: string, ttlMs = 60_000) {
  const existingTimer = optimisticReplyCleanupTimers.get(txid)
  if (existingTimer) {
    clearTimeout(existingTimer)
  }

  const cleanupTimer = setTimeout(() => {
    optimisticReplyCleanupTimers.delete(txid)
  }, ttlMs)

  optimisticReplyCleanupTimers.set(txid, cleanupTimer)
}

export function consumeOptimisticReply(txid: string): boolean {
  const cleanupTimer = optimisticReplyCleanupTimers.get(txid)

  if (!cleanupTimer) {
    return false
  }

  clearTimeout(cleanupTimer)
  optimisticReplyCleanupTimers.delete(txid)
  return true
}

export function clearOptimisticReply(txid: string) {
  const cleanupTimer = optimisticReplyCleanupTimers.get(txid)
  if (!cleanupTimer) {
    return
  }

  clearTimeout(cleanupTimer)
  optimisticReplyCleanupTimers.delete(txid)
}

export async function fetchMainFeedPosts(
  supabase: SupabaseClient,
  params: {
    feedType: MainFeedType
    blockHeight: number
    timePeriod: MainFeedTimePeriod
    page?: number
  }
): Promise<HydratedPost[]> {
  const { feedType, blockHeight, timePeriod, page = 0 } = params

  const offset = page * MAIN_FEED_PAGE_SIZE

  if (feedType === 'top') {
    if (!blockHeight) {
      throw new Error('Block height required for top feed')
    }

    const { data, error } = await supabase.rpc('get_active_locks', {
      current_block_height: blockHeight,
      time_cutoff: getTimeCutoff(timePeriod),
      page_limit: MAIN_FEED_PAGE_SIZE,
      page_offset: offset,
    })

    if (error) {
      throw error
    }

    return Array.isArray(data)
      ? data.map((post) =>
          normalizePostRow({
            ...post,
            profile: post.profile ?? post.profiles,
          })
        )
      : []
  }

  const { data, error } = await supabase
    .from('posts')
    .select(NEW_FEED_SELECT)
    .order('created_at', { ascending: false })
    .range(offset, offset + MAIN_FEED_PAGE_SIZE - 1)

  if (error) {
    throw error
  }

  return Array.isArray(data) ? data.map((post) => normalizePostRow(post)) : []
}

export async function fetchProfileFeedPage(
  supabase: SupabaseClient,
  params: {
    tab: ProfileFeedType
    profileUserId: string
    blockHeight: number
    page?: number
  }
): Promise<{ data: HydratedPost[]; nextPage: number | null }> {
  const { tab, profileUserId, blockHeight, page = 0 } = params
  const from = page * PROFILE_FEED_LIMIT
  const to = from + PROFILE_FEED_LIMIT - 1

  if (tab === 'liked') {
    const { data, error } = await supabase
      .from('likes')
      .select(`
        *,
        posts!inner (
          *,
          likes!left(
            *,
            liker_profile:profiles!likes_user_id_fkey!left(user_id, username, avatar_url, cover_url, created_at, updated_at)
          ),
          profile:profiles!posts_user_id_fkey!left(user_id, username, avatar_url, cover_url, created_at, updated_at),
          replies(count)
        )
      `)
      .eq('user_id', profileUserId)
      .gt('unlock_height', blockHeight)
      .order('created_at', { ascending: false })
      .range(from, to)

    if (error) {
      throw error
    }

    const transformedPosts = Array.isArray(data)
      ? data.map((item: Record<string, any>) => normalizePostRow(item.posts))
      : []

    const uniquePosts = Array.from(
      new Map(transformedPosts.map((post) => [post.txid, post])).values()
    )

    return {
      data: uniquePosts,
      nextPage: uniquePosts.length === PROFILE_FEED_LIMIT ? page + 1 : null,
    }
  }

  if (tab === 'top') {
    const { data, error } = await supabase.rpc('get_profile_top_posts', {
      current_block_height: blockHeight,
      profile_user_id: profileUserId,
      page_limit: PROFILE_FEED_LIMIT,
      page_offset: from,
    })

    if (error) {
      return { data: [], nextPage: null }
    }

    const posts = Array.isArray(data)
      ? data.map((post) =>
          normalizePostRow({
            ...post,
            profile: post.profile ?? post.profiles,
          })
        )
      : []

    return {
      data: posts,
      nextPage: posts.length === PROFILE_FEED_LIMIT ? page + 1 : null,
    }
  }

  const { data, error } = await supabase
    .from('posts')
    .select(`
      *,
      likes!left(
        *,
        liker_profile:profiles!likes_user_id_fkey!left(user_id, username, avatar_url, cover_url, created_at, updated_at)
      ),
      profile:profiles!posts_user_id_fkey!left(user_id, username, avatar_url, cover_url, created_at, updated_at),
      replies(count)
    `)
    .eq('user_id', profileUserId)
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) {
    throw error
  }

  const posts = Array.isArray(data) ? data.map((post) => normalizePostRow(post)) : []

  return {
    data: posts,
    nextPage: posts.length === PROFILE_FEED_LIMIT ? page + 1 : null,
  }
}

export async function fetchPostByTxid(
  supabase: SupabaseClient,
  txid: string
): Promise<HydratedPost | null> {
  const { data, error } = await supabase
    .from('posts')
    .select(SINGLE_POST_SELECT)
    .eq('txid', txid)
    .single()

  if (error || !data) {
    return null
  }

  return normalizePostRow(data)
}
