import { createClient } from '@/utils/supabase/server'
import { getOrCreateProfile } from '@/app/lib/ensure-profile'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import type { Profile } from '@/types'
import ProfileClient from './ProfileClient'

export default async function ProfilePage() {
  const supabase = await createClient()

  const { data: { user }, error: userError } = await supabase.auth.getUser() 

  if (userError || !user) {
    redirect('/login'); 
  }
 
  const userId = user.id
  const profile = (await getOrCreateProfile(supabase, user)) as unknown as Profile

  return (
    <ProfileClient
      profile={profile}
      userId={userId}
      updateProfileImage={updateProfileImage}
    />
  )
}

// Removed updateUsername server action

async function updateProfileImage(formData: FormData) {
  'use server'

  const supabase = await createClient()
  const { data: { user }, error: userError } = await supabase.auth.getUser()

  if (userError || !user) {
    throw new Error('Not authenticated')
  }

  const userId = user.id

  const file = formData.get('file') as File
  const type = formData.get('type') as 'avatar' | 'cover'
  
  if (!file || !type) {
    throw new Error('Missing file or type')
  }

  const fileExt = file.name.split('.').pop()
  const fileName = `${type}-${Date.now()}.${fileExt}`
  const filePath = `${userId}/${fileName}` // Use user_id for storage path

  const { error: uploadError } = await supabase.storage
    .from('profile-images')
    .upload(filePath, file)

  if (uploadError) {
    throw new Error(uploadError.message)
  }

  const { data: { publicUrl } } = supabase.storage
    .from('profile-images')
    .getPublicUrl(filePath)

  const { error: dbError } = await supabase
    .from('profiles')
    .upsert({
      user_id: userId,
      [`${type}_url`]: publicUrl
    })

  if (dbError) {
    throw new Error(dbError.message)
  }

  revalidatePath('/profile')
}
