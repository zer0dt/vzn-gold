'use client'

import { useState, useRef } from "react"
import { Wallet as WalletIcon, Loader2, Trophy } from "lucide-react"
import { Button } from "@/app/components/ui/button"
import { useRouter } from 'next/navigation'
import dynamic from 'next/dynamic'
import Link from "next/link"
import PostSheet from "@/app/components/PostSheet"
import { useAuth } from '@/app/contexts/AuthContext'
import { useWallet } from '@/app/hooks/use-wallet'
import { useToast } from "@/app/hooks/use-toast"

const ProfileBadge = dynamic(() => import("./ProfileBadge"), {
  ssr: false,
  loading: () => (
    <div className="px-3 py-2 mb-4">
      <div className="flex justify-center mb-1">
        <div className="inline-flex items-center gap-3 rounded-full border-2 border-amber-400 px-3 py-1.5 animate-pulse">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-muted" />
            <div className="w-20 h-4 rounded bg-muted" />
            <div className="w-4 h-4 rounded-full bg-gray-200 dark:bg-gray-700" />
          </div>
        </div>
      </div>
    </div>
  ),
})


export default function SidebarNavigation() {
  const [showPostSheet, setShowPostSheet] = useState(false);
  const { user, isLoading: isAuthLoading } = useAuth();
  const {
    isWalletInitialized,
    ownerAddress,
    walletAddress,
    profileOwnerAddress,
    profilePaymentAddress,
    profileUsername,
    profileAvatarUrl,
    isFetchingProfile,
  } = useWallet();
  const { toast } = useToast();
  const postButtonRef = useRef<HTMLButtonElement>(null);

  const router = useRouter()

  let badgeColor = '';
  if (!isAuthLoading && user && !isFetchingProfile) { // Ensure user is logged in and profile is loaded
    if (!profileOwnerAddress) { // Case 1: Profile has NO linked addresses
      badgeColor = 'red'; // Needs setup
    } else { // Case 2: Profile HAS linked addresses
      const localWalletMatchesProfile = 
        isWalletInitialized && 
        ownerAddress === profileOwnerAddress && 
        walletAddress === profilePaymentAddress;

      if (localWalletMatchesProfile) { // Subcase 2a: Local wallet is initialized and matches profile
        badgeColor = 'green'; // Ready
      } else { // Subcase 2b: Local wallet is not initialized or doesn't match profile
        badgeColor = 'red'; // Needs unlock/sync
      }
    }
  }

  const handlePostSheetClose = () => {
    setShowPostSheet(false);
    setTimeout(() => {
      postButtonRef.current?.focus();
    }, 50);
  };

  return (
    <>
      <nav className="space-y-4 sticky top-28 max-h-[calc(100vh-8rem)] overflow-y-auto pb-12">
        {/* User Profile Section - Render based on context user and loading state */}
        {user && (
          <ProfileBadge
            isAuthLoading={isAuthLoading}
            isFetchingProfile={isFetchingProfile}
            profileUsername={profileUsername}
            profileAvatarUrl={profileAvatarUrl}
            fallbackUsername={user.email?.split('@')[0] || ''}
            onNavigateProfile={() => router.push('/profile')}
          />
        )}

        {/* Wallet Button - Conditionally render if user is authenticated */}
        {!isAuthLoading && user && (
          <Button
            variant="ghost"
            className="w-full justify-start group relative"
            onClick={() => router.push('/wallet')}
          >
            {/* Icon Wrapper for Badge Positioning */} 
            <span className="relative mr-3"> 
              {isFetchingProfile ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <>
                  <WalletIcon className="h-5 w-5" />
                  {/* Notification Badge */} 
                  {badgeColor && (
                    <span 
                      className={`absolute -top-1 -right-1 h-3 w-3 rounded-full animate-pulse border-2 border-background ${badgeColor === 'red' ? 'bg-red-500' : 'bg-green-500'}`}
                      title={badgeColor === 'red' ? 'Wallet needs attention' : 'Wallet connected'}
                    />
                  )}
                </>
              )}
            </span>
            <span className="text-base font-sans">Wallet</span>
          </Button>
        )}

        {/* Leaderboard Button - Always visible */}
        <Button
          variant="ghost"
          className="w-full justify-start group"
          onClick={() => router.push('/leaderboard')}
        >
          <Trophy className="mr-3 h-5 w-5" />
          <span className="text-base font-sans">Leaderboard</span>
        </Button>

        {/* Profile Button - Conditionally render if user is authenticated */}
        {/* Removed the explicit Profile button
        {!isAuthLoading && user && (
          <Button
            variant="ghost"
            className="w-full justify-start group"
            onClick={() => router.push('/profile')}
          >
            <User className="mr-3 h-5 w-5" />
            <span className="text-base font-sans">Profile</span>
          </Button>
        )}
        */}


        
        {/* Smaller Post Button below search - Now always visible */}
        <div className={`px-3 mt-8 ${user ? 'pt-4' : ''}`}> 
            <Button
              ref={postButtonRef}
              variant="outline" // Apply outline variant
              onClick={() => {
                if (user) {
                  if (badgeColor === 'green') {
                    setShowPostSheet(true);
                  } else {
                    toast({
                      title: "Wallet Required",
                      description: "Posting is free, but connect a wallet to sign your posts",
                      variant: "default",
                    });
                  }
                } else {
                  toast({
                    title: "Login Required",
                    description: "Please login to post",
                    variant: "default",
                  });
                }
              }}
              className={`w-fit min-w-[160px] mx-auto rounded-full py-3 bg-inherit text-base font-semibold font-sans flex items-center justify-center 
                          border-2 border-amber-400 focus:border-amber-400
                          focus:ring-2 focus:ring-amber-400/45 focus:ring-offset-0
                          transition-colors duration-200 ease-in-out animate-pulse-orange 
                          text-foreground` // Ensure text color matches login button
                        }
            >
              Post
            </Button>
        </div>

        <div className="pt-3 text-center text-[11px] text-muted-foreground/70">
          <Link href="/terms" className="hover:text-foreground/90 transition-colors">
            Terms
          </Link>
          <span className="px-1.5">·</span>
          <Link href="/privacy" className="hover:text-foreground/90 transition-colors">
            Privacy
          </Link>
        </div>
      </nav>

      <PostSheet 
        isOpen={showPostSheet} 
        onClose={handlePostSheetClose} 
      />
    </>
  )
} 