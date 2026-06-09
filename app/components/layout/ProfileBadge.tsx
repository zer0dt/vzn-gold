"use client"

import Image from "next/image"

type ProfileBadgeProps = {
  isAuthLoading: boolean
  isFetchingProfile: boolean
  profileUsername: string | null
  profileAvatarUrl: string | null
  fallbackUsername: string
  onNavigateProfile: () => void
}

export default function ProfileBadge({
  isAuthLoading,
  isFetchingProfile,
  profileUsername,
  profileAvatarUrl,
  fallbackUsername,
  onNavigateProfile,
}: ProfileBadgeProps) {
  if (isAuthLoading) return null

  return (
    <div className="px-3 py-2 mb-4">
      <div className="flex justify-center mb-1">
        {isFetchingProfile ? (
          <div className="inline-flex items-center gap-3 rounded-full border-2 border-amber-400 px-3 py-1.5 animate-pulse">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-muted" />
              <div className="w-20 h-4 rounded bg-muted" />
              <div className="w-4 h-4 rounded-full bg-muted" />
            </div>
          </div>
        ) : (
          <div
            className="inline-flex items-center gap-3 rounded-full border-2 border-amber-400 px-3 py-1.5 cursor-pointer transition-colors"
            onClick={onNavigateProfile}
          >
            <div className="flex items-center gap-2">
              <div className="relative w-10 h-10 flex-shrink-0 rounded-full overflow-hidden ring-1 ring-border bg-muted hover:ring-2 hover:ring-primary/50 transition-all">
                {profileAvatarUrl ? (
                  <Image
                    src={profileAvatarUrl}
                    alt={profileUsername || "User Avatar"}
                    fill
                    sizes="40px"
                    className="object-cover"
                    loading="lazy"
                    fetchPriority="low"
                  />
                ) : (
                  <>
                    <Image
                      src="/default-avy.png"
                      alt="Default Avatar"
                      fill
                      sizes="40px"
                      className="object-cover transition-opacity duration-200 dark:opacity-0"
                      loading="lazy"
                      fetchPriority="low"
                    />
                    <Image
                      src="/default-avy.png"
                      alt="Default Avatar"
                      fill
                      sizes="40px"
                      className="object-cover transition-opacity duration-200 opacity-0 dark:opacity-100"
                      loading="lazy"
                      fetchPriority="low"
                    />
                  </>
                )}
              </div>
              <span className="font-vzn-headings text-base font-normal tracking-tight truncate max-w-[120px]">
                {profileUsername || fallbackUsername || "User"}
              </span>
              <Image
                src="/icons/orange-verified.svg"
                alt="Verified"
                title="Verified"
                width={16}
                height={16}
                className="inline-block align-middle"
                loading="lazy"
                fetchPriority="low"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
