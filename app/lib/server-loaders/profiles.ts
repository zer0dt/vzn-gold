import { cache } from 'react'

import type { Profile } from '@/types'
import { createClient } from '@/utils/supabase/server'

export const getProfileByUsername = cache(async (username: string): Promise<Profile | null> => {
  const supabase = await createClient()

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('username', username)
    .single<Profile>()

  if (error || !data) {
    return null
  }

  return data
})
