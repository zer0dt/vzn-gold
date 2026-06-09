import type { Post as PostType, Like } from '@/types'

/** Props for Post and its subcomponents — lives in a leaf module to avoid circular imports with index.tsx */
export type PostProps = {
  post: PostType & {
    likes?: Array<
      Like & {
        liker_profile?: { username?: string | null; avatar_url?: string | null } | null
      }
    >
    hasImage?: boolean
    profile?: {
      username: string | null
      avatar_url: string | null
      user_id: string
    } | null
  }
  blockHeight: number
  onReplyAdded?: () => void
  showDivider?: boolean
}
