import React, { useState, useEffect, useMemo } from 'react';
import Image from 'next/image';
import { Loader2 } from 'lucide-react';
import { getPostImageUrl } from '@/app/lib/post-image-utils';
import type { PostProps } from './postTypes';

type PostImageProps = {
  post: PostProps['post'];
  onImageClick: () => void; // Callback to open fullscreen dialog
};

/**
 * Displays the image attached to a post, if present.
 * Handles loading state and provides a click handler to view fullscreen.
 */
export const PostImage = React.memo(({ post, onImageClick }: PostImageProps) => {
  const imageUrl = useMemo(() => {
    return getPostImageUrl({
      txid: post.txid,
      content: post.content,
      hasImage: post.hasImage,
    });
  }, [post.txid, post.hasImage, post.content]);

  const [isImageLoading, setIsImageLoading] = useState(!!imageUrl);

  useEffect(() => {
    setIsImageLoading(!!imageUrl);
  }, [imageUrl]);


  // Don't render anything if there's no image
  if (!post.hasImage || !imageUrl) {
    return null;
  }

  const handleImageLoad = () => {
    setIsImageLoading(false);
  };

  const handleImageError = () => {
    console.warn(`Failed to load image for post ${post.txid} from ${imageUrl}`);
    setIsImageLoading(false);
  };

   const handleContainerClick = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent post navigation
    onImageClick();
  };

  return (
    <div className="mt-2">
      <div
        className="relative cursor-pointer"
        onClick={handleContainerClick}
      >
        {/* Image */}
        <Image
          src={imageUrl}
          alt="Post attachment"
          width={1200} // Provide desired render size
          height={675} // Maintain aspect ratio
          className="mx-auto block h-auto w-auto max-h-[420px] max-w-full rounded-2xl object-contain drop-shadow-[0_2px_10px_rgba(0,0,0,0.18)]"
          loading="lazy"
          unoptimized // If Gorilla Pool doesn't optimize or you don't want Next optimization
          onLoad={handleImageLoad}
          onError={handleImageError}
          style={{ visibility: isImageLoading ? 'hidden' : 'visible' }} // Hide image element until loaded
        />

        {/* Loading Skeleton */}
        {isImageLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/50 animate-pulse rounded-2xl">
            <Loader2 className="h-6 w-6 animate-spin text-primary/70" />
          </div>
        )}
      </div>
    </div>
  );
});

PostImage.displayName = 'PostImage'; 