import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import Image from 'next/image';
import { Loader2, RefreshCw } from 'lucide-react';
import { getPostImageUrl } from '@/app/lib/post-image-utils';
import type { PostProps } from './postTypes';

type PostImageProps = {
  post: PostProps['post'];
  onImageClick: () => void; // Callback to open fullscreen dialog
};

type ImageStatus = 'loading' | 'loaded' | 'processing';

// Backoff schedule (ms) for retrying while GorillaPool indexes the on-chain content.
const RETRY_DELAYS_MS = [3000, 5000, 8000, 13000, 21000, 30000];
const MAX_AUTO_RETRIES = RETRY_DELAYS_MS.length;

/**
 * Displays the image attached to a post, if present.
 * Handles loading + on-chain processing states and provides a click handler to view fullscreen.
 */
export const PostImage = React.memo(({ post, onImageClick }: PostImageProps) => {
  const imageUrl = useMemo(() => {
    return getPostImageUrl({
      txid: post.txid,
      content: post.content,
      hasImage: post.hasImage,
    });
  }, [post.txid, post.hasImage, post.content]);

  const [status, setStatus] = useState<ImageStatus>('loading');
  const [retryCount, setRetryCount] = useState(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cache-busting src so each retry actually re-requests the content.
  const imageSrc = useMemo(() => {
    if (!imageUrl) return null;
    return retryCount > 0 ? `${imageUrl}?retry=${retryCount}` : imageUrl;
  }, [imageUrl, retryCount]);

  // Reset state whenever the underlying image changes.
  useEffect(() => {
    setStatus('loading');
    setRetryCount(0);
  }, [imageUrl]);

  useEffect(() => {
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

  const handleImageLoad = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    setStatus('loaded');
  }, []);

  const handleImageError = useCallback(() => {
    setStatus('processing');
    setRetryCount((current) => {
      if (current >= MAX_AUTO_RETRIES) {
        return current; // Stop auto-retrying; user can retry manually.
      }
      const delay = RETRY_DELAYS_MS[current] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => {
        setStatus('loading');
        setRetryCount((c) => c + 1);
      }, delay);
      return current;
    });
  }, []);

  const handleManualRetry = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setStatus('loading');
    setRetryCount((c) => c + 1);
  }, []);

  const handleContainerClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent post navigation
    if (status === 'loaded') {
      onImageClick();
    }
  }, [status, onImageClick]);

  // Don't render anything if there's no image
  if (!post.hasImage || !imageSrc) {
    return null;
  }

  const isLoaded = status === 'loaded';
  const isProcessing = status === 'processing';
  const autoRetriesExhausted = isProcessing && retryCount >= MAX_AUTO_RETRIES;

  return (
    <div className="mt-2">
      <div
        className={`relative ${isLoaded ? 'cursor-pointer' : ''}`}
        onClick={handleContainerClick}
      >
        {/* Image (kept mounted so onLoad/onError keep firing across retries) */}
        <Image
          key={imageSrc}
          src={imageSrc}
          alt="Post attachment"
          width={1200} // Provide desired render size
          height={675} // Maintain aspect ratio
          className="mx-auto block h-auto w-auto max-h-[420px] max-w-full rounded-2xl object-contain drop-shadow-[0_2px_10px_rgba(0,0,0,0.18)]"
          loading="lazy"
          unoptimized // If Gorilla Pool doesn't optimize or you don't want Next optimization
          onLoad={handleImageLoad}
          onError={handleImageError}
          style={{ visibility: isLoaded ? 'visible' : 'hidden' }} // Hide image element until loaded
        />

        {/* Placeholder overlay while loading or processing on-chain */}
        {!isLoaded && (
          <div className="absolute inset-0 flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-2xl border border-border/50 bg-muted/40 px-4 text-center">
            {isProcessing ? (
              <>
                <div className="flex items-center gap-2 text-sm font-medium text-foreground/80">
                  {!autoRetriesExhausted && <Loader2 className="h-4 w-4 animate-spin text-primary/70" />}
                  <span>Processing image on-chain</span>
                </div>
                <p className="max-w-[260px] text-xs text-muted-foreground">
                  {autoRetriesExhausted
                    ? "This is taking longer than usual. The image will appear once it's indexed."
                    : 'This image is being processed onchain. This can take a moment.'}
                </p>
                {autoRetriesExhausted && (
                  <button
                    type="button"
                    onClick={handleManualRetry}
                    className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-amber-300/60 bg-amber-500 px-3 py-1 text-xs font-semibold uppercase tracking-[0.12em] text-black transition-colors hover:bg-amber-400"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Retry
                  </button>
                )}
              </>
            ) : (
              <Loader2 className="h-6 w-6 animate-spin text-primary/70" />
            )}
          </div>
        )}
      </div>
    </div>
  );
});

PostImage.displayName = 'PostImage'; 