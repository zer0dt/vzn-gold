import type { SupabaseClient, User } from '@supabase/supabase-js'

type GetOrCreateProfileOptions = {
  select?: string
}

const getDefaultUsername = (user: User) =>
  user.user_metadata?.display_name ||
  user.user_metadata?.full_name ||
  user.user_metadata?.name ||
  user.email?.split('@')[0] ||
  'User'

export async function getOrCreateProfile(
  supabase: SupabaseClient,
  user: User,
  options: GetOrCreateProfileOptions = {}
) {
  const select = options.select ?? '*'

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select(select)
    .eq('user_id', user.id)
    .maybeSingle()

  if (profileError) {
    throw profileError
  }

  if (profile) {
    return profile
  }

  const timestamp = new Date().toISOString()
  const { data: createdProfile, error: createError } = await supabase
    .from('profiles')
    .insert({
      user_id: user.id,
      username: getDefaultUsername(user),
      avatar_url: null,
      created_at: timestamp,
      updated_at: timestamp,
    })
    .select(select)
    .single()

  if (createError || !createdProfile) {
    throw createError ?? new Error('Failed to create profile')
  }

  return createdProfile
}
