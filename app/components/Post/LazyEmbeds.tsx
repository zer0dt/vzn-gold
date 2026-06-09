'use client'

import { useState, useEffect } from 'react';
import { useInView } from 'react-intersection-observer';
import dynamic from 'next/dynamic';
import { Loader2 } from 'lucide-react';
import { YOUTUBE_PLACEHOLDER_ASPECT_RATIO, DEXSCREENER_PLACEHOLDER_HEIGHT } from './postUtils';

// Dynamically import the actual embed components
const DynamicYouTubeEmbed = dynamic(() => import('../embeds/YouTubeEmbed'), {
  loading: () => <YouTubePlaceholder />,
  ssr: false
});

const DynamicDexScreenerEmbed = dynamic(() => import('../embeds/DexScreenerEmbed'), {
  loading: () => <DexScreenerPlaceholder />,
  ssr: false
});

const YouTubePlaceholder = () => (
  <div
    className="aspect-video bg-muted/30 animate-pulse rounded-md flex items-center justify-center"
    style={{ aspectRatio: YOUTUBE_PLACEHOLDER_ASPECT_RATIO }}
  >
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
  </div>
);

const DexScreenerPlaceholder = () => (
  <div
    className="bg-muted/30 animate-pulse rounded-md flex items-center justify-center"
    style={{ height: DEXSCREENER_PLACEHOLDER_HEIGHT }}
  >
    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
  </div>
);

const ClientOnly = ({ children }: { children: React.ReactNode }) => {
  const [hasMounted, setHasMounted] = useState(false);
  useEffect(() => {
    setHasMounted(true);
  }, []);

  if (!hasMounted) {
    return <DexScreenerPlaceholder />;
  }

  return <>{children}</>;
};


/**
 * Renders a YouTube embed lazily when it enters the viewport.
 * Uses IntersectionObserver and adds a small delay.
 */
export const LazyYouTubeEmbed = ({ url }: { url: string }) => {
  const [shouldRender, setShouldRender] = useState(false);
  const { ref, inView } = useInView({
    triggerOnce: true,
    threshold: 0.1, // Trigger when 10% visible
    // rootMargin: '200px 0px', // Optional: Load slightly before entering viewport
  });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (inView && !shouldRender) {
      // Small delay to prevent loading storm on fast scroll
      timer = setTimeout(() => {
        setShouldRender(true);
      }, 300); // Reduced delay
    }
    return () => clearTimeout(timer);
  }, [inView, shouldRender]);

  return (
    <div
      ref={ref}
      className="overflow-hidden rounded-lg mt-2" // Added margin and rounded corners
      style={{ minHeight: '100px', aspectRatio: YOUTUBE_PLACEHOLDER_ASPECT_RATIO }} // Ensure min height
    >
      {shouldRender ? (
        <DynamicYouTubeEmbed url={url} />
      ) : (
        <YouTubePlaceholder />
      )}
    </div>
  );
};

/**
 * Renders a DexScreener embed lazily when it enters the viewport.
 * Uses IntersectionObserver, ClientOnly wrapper, and adds a small delay.
 */
export const LazyDexScreenerEmbed = ({ url }: { url: string }) => {
  const [shouldRender, setShouldRender] = useState(false);
  const { ref, inView } = useInView({
    triggerOnce: true,
    threshold: 0.1, // Trigger when 10% visible
    // rootMargin: '200px 0px', // Optional: Load slightly before entering viewport
  });

   useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    if (inView && !shouldRender) {
      // Small delay
       timer = setTimeout(() => {
        setShouldRender(true);
      }, 300); // Reduced delay
    }
    return () => clearTimeout(timer);
  }, [inView, shouldRender]);

  return (
    <div
      ref={ref}
      className="overflow-hidden rounded-lg mt-2" // Added margin and rounded corners
      style={{ minHeight: `${DEXSCREENER_PLACEHOLDER_HEIGHT}px` }}
    >
      {shouldRender ? (
        <ClientOnly>
          <DynamicDexScreenerEmbed url={url} />
        </ClientOnly>
      ) : (
        <DexScreenerPlaceholder />
      )}
    </div>
  );
}; 