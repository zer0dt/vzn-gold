'use client'

import { useState, useEffect } from 'react'
import { Avatar, AvatarImage, AvatarFallback } from "@/app/components/ui/avatar"
import { ProfileFeed } from "@/app/components/ProfileFeed" // Keep ProfileFeed here if it needs client interactivity or state
import { ScrollToTop } from "@/app/components/ScrollToTop"
import Image from 'next/image' // Import Image component
import { ArrowLeft, X } from "lucide-react"
import dynamic from "next/dynamic"
import type { Profile } from '@/types'

// Import the BackButton as a client component
const BackButton = dynamic(() => import("@/app/components/BackButton"), {
  loading: () => <div className="w-9 h-9"></div>,
})

interface UserProfileClientProps {
  profile: Profile;
}

export function UserProfileClient({ profile }: UserProfileClientProps) {
  // State for modal
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalImageUrl, setModalImageUrl] = useState<string | null>(null);

  const openModal = (imageUrl: string | null) => {
    if (imageUrl) {
      setModalImageUrl(imageUrl);
      setIsModalOpen(true);
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setModalImageUrl(null);
  };

  // Allow closing the fullscreen image with the Escape key
  useEffect(() => {
    if (!isModalOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeModal();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isModalOpen]);

  const joinDate = new Date(profile.created_at);

  return (
    <div>
      <ScrollToTop />
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

      {/* Cover Image */}
      <div className="max-w-2xl mx-auto px-4">
        <div
          className={`relative w-full h-48 rounded-2xl overflow-hidden border border-border/60 backdrop-blur shadow-[0_0_0_1px_rgba(245,158,11,0.06)] ${profile.cover_url ? 'cursor-pointer' : ''}`}
          style={profile.cover_url ? {
            backgroundImage: `url(${profile.cover_url})`,
            backgroundSize: 'cover',
            backgroundPosition: 'center'
          } : {
            background: 'linear-gradient(135deg, rgba(245,158,11,0.18) 0%, rgba(245,158,11,0.06) 50%, rgba(245,158,11,0.02) 100%)'
          }}
          onClick={() => openModal(profile.cover_url)}
        />
      </div>

      {/* Profile section */}
      <div className="max-w-2xl mx-auto">
        <div className="px-6 sm:px-6">
          <div className="relative -mt-16">
             {/* Wrap Avatar interaction */}
             <div className="cursor-pointer inline-block group" onClick={() => openModal(profile.avatar_url)}>
               <Avatar className="h-32 w-32 ring-4 ring-background bg-muted shadow-[0_12px_32px_-12px_rgba(245,158,11,0.35)] transition-transform group-hover:scale-[1.02]">
                 {profile.avatar_url ? (
                   <AvatarImage src={profile.avatar_url} alt={profile.username || 'User Avatar'} />
                 ) : (
                   <>
                     <AvatarImage src="/default-avy.png" alt="Default Avatar" className="transition-opacity duration-200 dark:opacity-0" />
                     <AvatarImage src="/default-avy.png" alt="Default Avatar" className="absolute inset-0 transition-opacity duration-200 opacity-0 dark:opacity-100" />
                   </>
                 )}
                 <AvatarFallback className="bg-gray-200 dark:bg-gray-700 animate-pulse" />
               </Avatar>
             </div>

             {/* Username, Badge, and Join Date container */}
             <div className="mt-2">
               <div className="flex items-center gap-1.5">
                  <div className="font-vzn-headings text-lg font-normal tracking-tight">
                    {profile.username || 'Anonymous User'}
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
                 {`Joined ${joinDate.toLocaleDateString('en-US', {
                   month: 'long',
                   year: 'numeric'
                 })}`}
               </div>
             </div>

            {/* Placeholder for potential actions/buttons */}
            <div>
              {/* Example: Server Component button or pass props to another client component */}
            </div>
          </div>
        </div>

        {/* ProfileFeed might need profile data too */}
        <ProfileFeed profile={profile} />
      </div>

      {/* Image Modal */}
      {isModalOpen && modalImageUrl && (
        <div
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/90 p-4"
          onClick={closeModal} // Close modal when clicking the background
          role="dialog"
          aria-modal="true"
          aria-label="Fullscreen image view"
        >
          {/* Close Button */}
          <button
            type="button"
            aria-label="Close fullscreen image view"
            className="absolute right-4 top-4 z-[111] rounded-full opacity-80 transition-opacity hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60"
            onClick={closeModal}
          >
            <X className="h-8 w-8 rounded-full bg-black/40 p-1 text-white" />
          </button>

          {/* Image */}
          <Image
            key={modalImageUrl}
            src={modalImageUrl}
            alt="Fullscreen view"
            width={1920}
            height={1080}
            className="max-h-[95vh] w-auto max-w-[95vw] object-contain select-none"
            unoptimized
            priority
            onClick={(e) => e.stopPropagation()} // Prevent closing when clicking the image itself
          />
        </div>
      )}
    </div>
  );
} 