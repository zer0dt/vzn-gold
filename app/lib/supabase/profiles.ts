import type { Profile } from '@/types'
import type { SupabaseClient } from '@supabase/supabase-js'

export const FULL_PROFILE_SELECT =
  'user_id, username, avatar_url, cover_url, created_at, updated_at'

export function buildFallbackProfile(
  userId: string | null | undefined,
  fallbackUsername = 'Anon'
): Profile {
  const now = new Date().toISOString()

  return {
    user_id: userId ?? '',
    username: fallbackUsername,
    avatar_url: null,
    cover_url: null,
    created_at: now,
    updated_at: now,
  }
}

export async function getProfileByUserId(
  supabase: SupabaseClient,
  userId: string | null | undefined,
  options?: {
    cache?: Map<string, Profile>
    fallbackUsername?: string
  }
): Promise<Profile> {
  const fallbackUsername = options?.fallbackUsername ?? 'Anon'

  if (!userId) {
    return buildFallbackProfile(null, fallbackUsername)
  }

  const cachedProfile = options?.cache?.get(userId)
  if (cachedProfile) {
    return cachedProfile
  }

  try {
    const { data, error } = await supabase
      .from('profiles')
      .select(FULL_PROFILE_SELECT)
      .eq('user_id', userId)
      .single()

    if (error || !data) {
      const fallbackProfile = buildFallbackProfile(userId, fallbackUsername)
      options?.cache?.set(userId, fallbackProfile)
      return fallbackProfile
    }

    options?.cache?.set(userId, data)
    return data
  } catch {
    const fallbackProfile = buildFallbackProfile(userId, fallbackUsername)
    options?.cache?.set(userId, fallbackProfile)
    return fallbackProfile
  }
}
