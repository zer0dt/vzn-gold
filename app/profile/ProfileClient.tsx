'use client'

import dynamic from 'next/dynamic'
import Image from 'next/image'
import { ArrowLeft } from 'lucide-react'
import { CoverImageForm } from '@/app/components/CoverImageForm'
import { ProfileImageForm } from '@/app/components/ProfileImageForm'
import ProfileFeedClient from '@/app/components/ProfileFeedClient'
import type { Profile } from '@/types'

const BackButton = dynamic(() => import('@/app/components/BackButton'), {
  loading: () => <div className="w-9 h-9" />,
})

type ProfileClientProps = {
  profile: Profile
  userId: string
  updateProfileImage: (formData: FormData) => Promise<void>
}

export default function ProfileClient({ profile, userId, updateProfileImage }: ProfileClientProps) {
  return (
    <div>
      {/* Header with Back Button and Username */}
      <div className="w-full max-w-2xl lg:mt-8 mt-8 mx-auto px-4">
        <div className="flex items-center gap-3 mb-4">
          <BackButton>
            <ArrowLeft className="h-5 w-5" />
          </BackButton>
          <div className="flex-1 flex justify-between items-center">
            <h1 className="font-vzn-headings text-2xl font-normal tracking-tight">{profile.username || 'Profile'}</h1>
          </div>
        </div>
      </div>

      {/* Cover Image Form */}
      <div className="max-w-2xl mx-auto px-4">
        <div className="rounded-2xl overflow-hidden border border-border/60 backdrop-blur shadow-[0_0_0_1px_rgba(245,158,11,0.06)]">
          <CoverImageForm currentUrl={profile.cover_url} action={updateProfileImage} />
        </div>
      </div>

      <div className="max-w-2xl mx-auto">
        <div className="px-6 sm:px-6">
          <div className="relative -mt-16">
            {/* Avatar Form */}
            <div className="inline-block">
              <ProfileImageForm
                type="avatar"
                currentUrl={profile.avatar_url}
                action={updateProfileImage}
                className="h-32 w-32 ring-4 ring-background shadow-[0_12px_32px_-12px_rgba(245,158,11,0.35)]"
              />
            </div>

            {/* Username and Join Date */}
            <div className="mt-2">
              <div className="flex items-center gap-1.5">
                <div className="font-vzn-headings text-lg font-normal tracking-tight">
                  {profile.username || `User ${userId.substring(0, 6)}...`}
                </div>
                <Image
                  src="/icons/orange-verified.svg"
                  alt="Verified"
                  title="Verified"
                  width={16}
                  height={16}
                  className="inline-block align-middle"
                />
              </div>
              <div className="mt-1 pb-2 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {`Joined ${new Date(profile.created_at).toLocaleDateString('en-US', {
                  month: 'long',
                  year: 'numeric',
                })}`}
              </div>
            </div>
          </div>
        </div>

        {/* Client-side feed component - receives fetched profile */}
        <ProfileFeedClient profile={profile} />
      </div>
    </div>
  )
}
