'use client'

import { useState, useEffect, memo, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'

import { useQueryClient } from '@tanstack/react-query'
import { createClient } from '@/utils/supabase/client'

// Hooks and Libs
import { useBSVPrice } from '@/app/hooks/use-bsv-price'
import { useToast } from "@/app/hooks/use-toast"
import { useWallet } from '@/app/hooks/use-wallet'
import { useAuth } from '@/app/contexts/AuthContext'

import type { Like } from '@/types'
import type { PostProps } from './postTypes'

// Sub-Components
import { PostHeader } from './PostHeader'
import { PostContent } from './PostContent'
import { PostImage } from './PostImage'
import { PostActions } from './PostActions'
import { LockSheet } from './LockSheet'
import { ImageFullscreenDialog } from './ImageFullscreenDialog'
import CommentSheet from '../CommentSheet' // Keep existing import
import AuthModal from '../layout/AuthModal'
import { handleConfirmLockAction } from './lockActions'

// Utilities
import { getTotalLockedSats } from '@/app/lib/utils' // Adjust path
import { getPostImageUrl } from '@/app/lib/post-image-utils'
import { Avatar, AvatarImage, AvatarFallback } from "@/app/components/ui/avatar";

export type { PostProps }

/**
 * The main Post component, orchestrating sub-components for header,
 * content, image, actions, and interactive sheets/dialogs.
 */
export const Post = memo(function Post({ post, blockHeight, onReplyAdded, showDivider = true }: PostProps) {
  const queryClient = useQueryClient()
  const supabase = createClient()
  const { toast } = useToast()
  const { bsvPrice, isError: isPriceError } = useBSVPrice()
  const walletContext = useWallet()

  const { user } = useAuth()
  const router = useRouter()

  // State for Sheets/Dialogs visibility
  const [showCommentSheet, setShowCommentSheet] = useState(false)
  const [isLockSheetOpen, setIsLockSheetOpen] = useState(false)
  const [isImageFullscreen, setIsImageFullscreen] = useState(false)
  const [showAuthModal, setShowAuthModal] = useState(false)

  // State for Async Operations (Locking)
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)

  const hasResolvedBlockHeight = blockHeight > 0

  // State for Lock Amount Animation
  const [prevTotalLockedSats, setPrevTotalLockedSats] = useState(() =>
    hasResolvedBlockHeight
      ? getTotalLockedSats(post.likes?.filter((like) => like.unlock_height > blockHeight) || [])
      : 0
  );
  const [isAmountAnimating, setIsAmountAnimating] = useState(false);

   // Reply count comes from post data (lazy loaded - full replies fetched only when CommentSheet opens)
   const replyCount = post.reply_count ?? 0;

  // Normalize likes data
  const likes: Like[] = useMemo(() => post.likes || [], [post.likes]); // Ensure likes is always an array
  const activeLikes = useMemo(
    () => (hasResolvedBlockHeight ? likes.filter((like) => like.unlock_height > blockHeight) : []),
    [hasResolvedBlockHeight, likes, blockHeight]
  ); // Only derive active likes once block height is known

  // --- Effects ---

  // Animate lock amount change
   useEffect(() => {
      const currentTotal = getTotalLockedSats(activeLikes); // Use calculated activeLikes
      if (currentTotal !== prevTotalLockedSats) {
          setIsAmountAnimating(true);
          // Update previous total after a short delay to allow animation to start
          const timer = setTimeout(() => setPrevTotalLockedSats(currentTotal), 100);
          // End animation after it completes
          const animTimer = setTimeout(() => setIsAmountAnimating(false), 600); // Match animation duration
           return () => {
              clearTimeout(timer);
              clearTimeout(animTimer);
           };
      }
       // Ensure animation state is false if totals match
       setIsAmountAnimating(false);
  }, [activeLikes, prevTotalLockedSats]); // Depends on calculated activeLikes

  // --- Event Handlers ---

  const handleConfirmLock = useCallback(
    async (satsToLock: number, blocksToLock: number) => {
      await handleConfirmLockAction({
        satsToLock,
        blocksToLock,
        post,
        blockHeight,
        supabase,
        queryClient,
        toast,
        walletContext,
        user,
        setIsProcessing,
        setProgress,
        setIsLockSheetOpen,
      });
    },
    [post, blockHeight, supabase, queryClient, toast, walletContext, user]
  ); 


   // --- Image Fullscreen Handling ---
   const attachedImageUrl = useMemo(() => {
    return getPostImageUrl({
      txid: post.txid,
      content: post.content,
      hasImage: post.hasImage,
    });
  }, [post.txid, post.hasImage, post.content]);

  const handleImageClick = useCallback(() => {
    if (attachedImageUrl) {
      setIsImageFullscreen(true);
    }
  }, [attachedImageUrl]);


  // --- Render ---
  return (
    <article className="px-4 font-post-sans">
      <div
        className={`relative flex gap-3 pt-3 pb-1 cursor-pointer transition-colors hover:bg-muted/40${showDivider ? ' border-b border-border/60' : ''}`}
        onClick={() => router.push(`/tx/${post.txid}`)}
      >
        {/* Left: Avatar */}
        <div 
          className="flex-shrink-0 cursor-pointer"
          onClick={(e) => {
            e.stopPropagation();
            const userIdentifier = post.profile?.username || post.user_id;
            if (userIdentifier) {
              router.push(`/${userIdentifier}`);
            }
          }}
        >
          <Avatar className="h-10 w-10 ring-1 ring-border/60 bg-muted hover:ring-2 hover:ring-amber-400/50 transition-all" title={`View profile: ${post.profile?.username || ''}`}>
            {post.profile?.avatar_url ? (
              <AvatarImage src={post.profile.avatar_url} alt={post.profile?.username || 'Avatar'} />
            ) : (
              <>
                <AvatarImage src="/default-avy.png" alt="Default Avatar" className="transition-opacity duration-200 dark:opacity-0" />
                <AvatarImage src="/default-avy.png" alt="Default Avatar" className="absolute inset-0 transition-opacity duration-200 opacity-0 dark:opacity-100" />
              </>
            )}
            <AvatarFallback>{(post.profile?.username?.charAt(0) || 'U').toUpperCase()}</AvatarFallback>
          </Avatar>
        </div>

        {/* Right: Main column */}
        <div className="min-w-0 flex-1">
          <PostHeader post={post} />
          <PostContent post={post} />
          <PostImage post={post} onImageClick={handleImageClick} />
          <PostActions
            post={post}
            replyCount={replyCount}
            likes={likes}
            blockHeight={blockHeight || 0}
            isAmountAnimating={isAmountAnimating}
            onShowComments={() => setShowCommentSheet(true)}
            onShowLock={() => setIsLockSheetOpen(true)}
          />
        </div>
      </div>

      {/* --- Sheets & Dialogs (Remain outside the flex layout) --- */}
      {showCommentSheet && (
        <CommentSheet
          isOpen={showCommentSheet}
          onClose={() => setShowCommentSheet(false)}
          postTxid={post.txid}
          ownerUserId={post.user_id}
          onReplyAdded={onReplyAdded}
        />
      )}

      {/* Image Fullscreen Dialog */}
      {isImageFullscreen && (
        <ImageFullscreenDialog
          isOpen={isImageFullscreen}
          onOpenChange={setIsImageFullscreen}
          imageUrl={attachedImageUrl}
        />
      )}

      {/* Lock Sheet */}
      {isLockSheetOpen && (
        <LockSheet
          isOpen={isLockSheetOpen}
          onOpenChange={setIsLockSheetOpen}
          bsvPrice={bsvPrice}
          isPriceError={isPriceError}
          isLocking={isProcessing}
          progress={progress}
          onConfirmLock={handleConfirmLock}
          onRequestLogin={() => setShowAuthModal(true)}
        />
      )}

      <AuthModal open={showAuthModal} onOpenChange={setShowAuthModal} />

    </article>
  )
});

Post.displayName = 'Post';
