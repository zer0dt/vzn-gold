export type MainFeedType = 'new' | 'top'
export type MainFeedTimePeriod = '24h' | 'week' | 'month' | 'year' | 'all'
export type ProfileFeedType = 'new' | 'top' | 'liked'

export const TOP_TIME_PERIODS: MainFeedTimePeriod[] = ['24h', 'week', 'month', 'year', 'all']

export const feedQueryKeys = {
  new: () => ['posts', 'new'] as const,
  top: (timePeriod: MainFeedTimePeriod) => ['posts', 'top', timePeriod] as const,
  byType: (feedType: MainFeedType, timePeriod: MainFeedTimePeriod) => {
    if (feedType === 'new') return feedQueryKeys.new()
    return feedQueryKeys.top(timePeriod)
  },
  allMain: () => [
    feedQueryKeys.new(),
    ...TOP_TIME_PERIODS.map((timePeriod) => feedQueryKeys.top(timePeriod)),
  ],
}

export const profileQueryKeys = {
  new: (userId: string) => ['user-posts', 'new', userId] as const,
  top: (userId: string) => ['user-posts', 'top', userId] as const,
  liked: (userId: string) => ['user-posts', 'liked', userId] as const,
  byTab: (tab: ProfileFeedType, userId: string) => {
    if (tab === 'new') return profileQueryKeys.new(userId)
    if (tab === 'top') return profileQueryKeys.top(userId)
    return profileQueryKeys.liked(userId)
  },
}

export const replyQueryKeys = {
  byPost: (postTxid: string) => ['replies', postTxid] as const,
}

export const singlePostQueryKeys = {
  byTxid: (txid: string) => ['post', txid] as const,
}
