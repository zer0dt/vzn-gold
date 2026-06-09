import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import dynamic from 'next/dynamic';

import { components as tweetComponents, tweetEmbedClassName } from '../embeds/X/tweet-components'; // Assuming path
import { SafeTweet } from '../embeds/X/SafeTweet';
import { LazyYouTubeEmbed, LazyDexScreenerEmbed } from './LazyEmbeds';
import { TWITTER_PATTERN, YOUTUBE_PATTERN, DEXSCREENER_PATTERN, LINK_PATTERN, extractTweetId } from './postUtils';
import type { PostProps } from './postTypes';
// NFT listing feature removed

const CHARACTER_LIMIT = 280; // X/Twitter-like limit

// Dynamic import for LinkCard
const DynamicLinkCard = dynamic(() => import('../LinkCard'), { // Assuming path
  loading: () => (
    <div className="block border rounded-lg overflow-hidden animate-pulse mt-2">
      <div className="p-4">
        <div className="h-5 w-3/4 bg-muted mb-2 rounded" />
        <div className="h-4 w-full bg-muted/50 mb-2 rounded" />
        <div className="flex justify-end">
          <div className="h-3 w-24 bg-muted/30 rounded" />
        </div>
      </div>
    </div>
  ),
  ssr: false
});


type PostContentProps = {
  post: PostProps['post'];
};

/**
 * Renders the main content of the post, including formatted text (Markdown),
 * and embeds for Twitter, YouTube, DexScreener, NFT listings, and generic links.
 */
export const PostContent = React.memo(({ post }: PostContentProps) => {
  const router = useRouter();
  const [isExpanded, setIsExpanded] = useState(false);
  
  const content = post.content || '';
  // Strip any legacy NFT listing comments from content
  const cleanContent = useMemo(() => {
    return content.replace(/<!-- NFT_LISTING:.*? -->/g, '').trim();
  }, [content]);

  // Memoize extracted embed URLs and Tweet ID using clean content
  const { twitterUrl, youtubeUrl, dexscreenerUrl, linkUrls } = useMemo(() => {
    // Explicitly type the results of Array.from
    const twitterMatches = Array.from(cleanContent.matchAll(TWITTER_PATTERN)) as RegExpMatchArray[];
    const youtubeMatches = Array.from(cleanContent.matchAll(YOUTUBE_PATTERN)) as RegExpMatchArray[];
    const dexscreenerMatches = Array.from(cleanContent.matchAll(DEXSCREENER_PATTERN)) as RegExpMatchArray[];
    const allLinkMatches = Array.from(cleanContent.matchAll(LINK_PATTERN)) as RegExpMatchArray[];

    const twitterMatch = twitterMatches[0] || null;
    const youtubeMatch = youtubeMatches[0] || null;
    const dexscreenerMatch = dexscreenerMatches[0] || null;

    const linkMatches = allLinkMatches
      .filter(match => {
        // Ensure we capture the URL correctly from markdown or plain links
        const url = (match?.[3] || match?.[0])?.replace(/\)?$/, '') ?? ''; // Add null checks and default
        // Exclude DexScreener links from the generic link list
        return !!url && !url.match(/dexscreener\.com/i);
      });

    return {
      twitterUrl: twitterMatch?.[0]?.split('?')[0] ?? null, // Add null checks
      youtubeUrl: youtubeMatch?.[0]?.split('&')[0] ?? null, // Add null checks
      dexscreenerUrl: dexscreenerMatch?.[0]?.split('?')[0] ?? null, // Add null checks
       // Extract the URL, handling both markdown [text](url) and plain url cases
      linkUrls: linkMatches.map(match => (match?.[3] || match?.[0])?.replace(/\)?$/, '').trim() ?? '') // Add null checks
                      .filter(url => !!url) // Filter out any empty strings resulting from null checks
    };
  }, [cleanContent]);

  const tweetId = useMemo(() => extractTweetId(twitterUrl), [twitterUrl]);

  // Keep the original content with links visible (no URL removal)
  const displayContent = useMemo(() => {
    const trimmedContent = cleanContent.trim();
    const shouldTruncate = trimmedContent.length > CHARACTER_LIMIT && !isExpanded;
    
    if (shouldTruncate) {
      // Find a good place to cut off (try to avoid cutting mid-word)
      let cutPoint = CHARACTER_LIMIT;
      const substring = trimmedContent.substring(0, cutPoint);
      const lastSpace = substring.lastIndexOf(' ');
      
      // If we find a space within 20 characters of our limit, use that
      if (lastSpace > CHARACTER_LIMIT - 20) {
        cutPoint = lastSpace;
      }
      
      return trimmedContent.substring(0, cutPoint) + '...';
    }
    
    return trimmedContent;
  }, [cleanContent, isExpanded]);

  const shouldShowToggle = cleanContent.trim().length > CHARACTER_LIMIT;

  const handleContentClick = () => {
    router.push(`/tx/${post.txid}`);
  };

  const stopPropagation = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const handleToggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded(!isExpanded);
  };

  return (
    <div
      onClick={handleContentClick}
      className="relative z-[1] cursor-pointer break-words overflow-wrap-anywhere text-[15px] leading-6 font-post-sans"
    >
      {/* Render original text content with links via Markdown */}
      {displayContent && (
         <ReactMarkdown
          remarkPlugins={[remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={{
            a: ({ node, ...props }) => (
              <a
                {...props}
                className="text-primary hover:underline"
                target="_blank"
                rel="noopener noreferrer"
                onClick={stopPropagation} // Prevent navigation when clicking links within content
              />
            ),
            // Add other custom renderers if needed
          }}
        >
          {displayContent}
        </ReactMarkdown>
      )}

      {/* Show more/less toggle */}
      {shouldShowToggle && (
        <button
          onClick={handleToggleExpand}
          className="text-primary hover:underline text-sm font-medium py-0 -mt-0.5"
        >
          {isExpanded ? 'Show less' : 'Show more'}
        </button>
      )}

      {/* Twitter Embed */}
      {tweetId && (
        <div className={`${tweetEmbedClassName} px-2`} onClick={stopPropagation}>
          <SafeTweet id={tweetId} components={tweetComponents} />
        </div>
      )}

      {/* YouTube Embed */}
      {youtubeUrl && (
         <div onClick={stopPropagation}>
             <LazyYouTubeEmbed url={youtubeUrl} />
         </div>
      )}

      {/* DexScreener Embed */}
      {dexscreenerUrl && (
        <div onClick={stopPropagation}>
            <LazyDexScreenerEmbed url={dexscreenerUrl} />
        </div>
      )}

      {/* Link Cards */}
      {linkUrls.length > 0 && (
        <div className="mt-2 space-y-2" onClick={stopPropagation}>
          {linkUrls.map((url, index) => (
             <DynamicLinkCard
                key={`link-${index}-${post.txid}`} // More specific key
                href={url}
                // className is handled internally by DynamicLinkCard or pass if needed
              >
                {/* LinkCard might handle displaying the URL, or pass it as child */}
                {/* {url} */}
                {url}
             </DynamicLinkCard>
          ))}
        </div>
      )}
    </div>
  );
});

PostContent.displayName = 'PostContent'; 