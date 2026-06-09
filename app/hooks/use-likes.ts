import { useQuery } from '@tanstack/react-query'
import type { Like } from '@/types'

interface LikesResponse {
  likes: Like[]
  hasMore: boolean
  totalCount: number
  totalSatsLocked: number
}

interface UseLikesParams {
  userId: string | null
  tab: 'active' | 'unlockable' | 'spent'
  blockHeight: number
  enabled?: boolean
}

export function useLikes({ userId, tab, blockHeight, enabled = true }: UseLikesParams) {
  return useQuery<LikesResponse>({
    queryKey: ['likes', userId, tab, blockHeight],
    queryFn: async () => {
      if (!userId) {
        return {
          likes: [],
          hasMore: false,
          totalCount: 0,
          totalSatsLocked: 0
        }
      }

      const params = new URLSearchParams({
        user_id: userId,
        tab,
        block_height: blockHeight.toString(),
        with_posts: 'false' // We don't need post data for the vault
      })

      const response = await fetch(`/api/likes?${params}`)
      
      if (!response.ok) {
        throw new Error('Failed to fetch likes')
      }

      return response.json()
    },
    enabled: enabled && !!userId && blockHeight > 0,
    staleTime: 1000 * 30, // 30 seconds
    gcTime: 1000 * 60 * 5, // 5 minutes
  })
} 