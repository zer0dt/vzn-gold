import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { HydrationBoundary, QueryClient, dehydrate } from '@tanstack/react-query'

import { UserProfileClient } from '@/app/components/UserProfileClient' // Import the new client component
import { profileQueryKeys } from '@/app/lib/query-keys'
import { getProfileByUsername } from '@/app/lib/server-loaders/profiles'
import { fetchProfileFeedPage } from '@/app/lib/supabase/posts'
import { createClient } from '@/utils/supabase/server'

const isValidUsernameSegment = (username: string) => {
  return !username.includes('.')
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ username: string }>
}): Promise<Metadata> {
  const { username } = await params
  if (!isValidUsernameSegment(username)) {
    return {}
  }

  const profile = await getProfileByUsername(username)

  const profileName = profile?.username || username
  const title = `${profileName}'s Profile | Bitcoin Social Media`
  const description = `View @${profileName}'s profile on VZN.GOLD — Bitcoin Social Media.`
  const image = profile?.cover_url || profile?.avatar_url || '/images/opengraph.png'
  const url = `https://vzn.gold/${profileName}`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      url,
      images: [image],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [image],
    },
  }
}


export default async function UserProfilePage({
  params
}: {
  params: Promise<{ username: string }>
}) {
  const { username } = await params;
  if (!isValidUsernameSegment(username)) {
    notFound()
  }

  const profile = await getProfileByUsername(username)

  // Handle potential fetch error
   if (!profile) {
    console.error("Error fetching profile:", username);
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] p-4">
        <h2 className="text-lg font-medium text-muted-foreground">
          Profile not found or could not be loaded.
        </h2>
      </div>
    )
  }

  const queryClient = new QueryClient()
  const supabase = await createClient()

  await queryClient.prefetchInfiniteQuery({
    queryKey: profileQueryKeys.new(profile.user_id),
    queryFn: ({ pageParam = 0 }) =>
      fetchProfileFeedPage(supabase, {
        tab: 'new',
        profileUserId: profile.user_id,
        blockHeight: 0,
        page: pageParam as number,
      }),
    initialPageParam: 0,
    getNextPageParam: (
      lastPage: Awaited<ReturnType<typeof fetchProfileFeedPage>>
    ) => lastPage.nextPage,
  })

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <UserProfileClient profile={profile} />
    </HydrationBoundary>
  )
} 