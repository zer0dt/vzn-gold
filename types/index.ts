export type Post = {
  txid: string
  user_id: string
  content: string | null
  wallet_address: string | null
  has_image: boolean
  created_at: string
  reply_count?: number
  profiles?: Profile
  likes?: Like[]
}

export type Like = {
  txid: string
  contract_id: string
  contract_input_txid: string
  contract_input_vout: number
  contract_output_vout: number | null
  reward_amount: number | null
  mint_index: number | null
  post_txid: string
  user_id: string
  sats_amount: number
  blocks_locked: number
  block_height: number
  unlock_height: number
  is_spent: boolean
  spent_txid: string | null
  created_at: string
  posts?: Post
  profiles?: Profile
}

export type RealtimePayload = {
  schema: string
  table: string
  commit_timestamp: string
  eventType: string
  new: {
    txid: string
    contract_id: string
    contract_input_txid: string
    contract_input_vout: number
    contract_output_vout: number | null
    reward_amount: number | null
    mint_index: number | null
    post_txid: string
    user_id: string
    sats_amount: number
    blocks_locked: number
    block_height: number
    unlock_height: number
    is_spent: boolean
    spent_txid: string | null
    created_at: string
  } | null
  old: Record<string, unknown>
  errors: unknown | null
}

export type Reply = {
  txid: string
  post_txid: string
  user_id: string
  content: string
  has_image?: boolean
  hasImage?: boolean
  created_at: string
  profiles?: Profile
}

export type Profile = {
  user_id: string
  username: string | null
  avatar_url: string | null
  cover_url: string | null
  created_at: string
  updated_at: string
}

/** Loose metadata bag from ordinals / token APIs (BSV21, etc.). */
export type TokenMeta = Record<string, unknown>

/** Leaderboard row: per-user aggregates (list UI). */
export type LeaderboardProfile = {
  user_id: string
  username?: string
  avatar_url?: string
  owner_public_key: string
  totalLockedSats: number
  activeLocksCount: number
  mockVZN: number
}

/** Server leaderboard shape including nested likes used when computing aggregates. */
export type LeaderboardProfileWithLikes = LeaderboardProfile & {
  likes: Like[]
}

/** Subset of {@link Like} fields delivered on realtime like inserts. */
export type LikeRealtimeSnapshot = Pick<
  Like,
  'txid' | 'post_txid' | 'user_id' | 'sats_amount' | 'unlock_height' | 'created_at'
>
