/**
 * Utility functions and constants specific to the Post component.
 */

// Patterns for detecting embeddable URLs
export const TWITTER_PATTERN = /https?:\/\/((?:x|twitter)\.com\/\w+\/status\/\d+)[^\s]*/gi;
export const YOUTUBE_PATTERN = /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=[^&\s]+|youtu\.be\/[^&\s]+)[^\s]*/gi;
export const DEXSCREENER_PATTERN = /https?:\/\/(?:www\.)?dexscreener\.com\/([^/\s]+)\/([^/\s?&]+)[^\s]*/gi;
const URL_PATTERN = /https?:\/\/[^\s<>()]+/gi;
const TRAILING_URL_PUNCTUATION = /[.,!?;:'"\]]+$/;

const isSpecialEmbedUrl = (url: string): boolean => {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
    return (
      hostname === 'x.com' ||
      hostname === 'twitter.com' ||
      hostname === 'youtube.com' ||
      hostname === 'youtu.be' ||
      hostname === 'dexscreener.com'
    );
  } catch {
    return false;
  }
};

const cleanExtractedUrl = (url: string): string =>
  url.replace(TRAILING_URL_PUNCTUATION, '');

export const extractGenericLinkUrls = (content: string): string[] => {
  const urls = Array.from(content.matchAll(URL_PATTERN), (match) =>
    cleanExtractedUrl(match[0])
  ).filter((url) => !isSpecialEmbedUrl(url));

  return Array.from(new Set(urls));
};

/**
 * Removes URLs that are represented by an embed while preserving custom
 * Markdown link labels and surrounding punctuation.
 */
export const stripEmbeddedUrls = (content: string): string =>
  content
    .replace(
      /\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/gi,
      (_match, label: string, url: string) =>
        label.trim() && label.trim() !== url ? label : ''
    )
    .replace(URL_PATTERN, (match) => {
      const trailingPunctuation = match.match(TRAILING_URL_PUNCTUATION)?.[0] ?? '';
      return trailingPunctuation;
    })
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

// Placeholder dimensions for embeds before they load
export const YOUTUBE_PLACEHOLDER_ASPECT_RATIO = 16 / 9;
export const DEXSCREENER_PLACEHOLDER_HEIGHT = 400;

/**
 * Extracts the Tweet ID from a Twitter/X URL.
 * @param url - The Twitter/X status URL.
 * @returns The Tweet ID string, or null if not found.
 */
export const extractTweetId = (url: string | null): string | null => {
    if (!url) return null;
    const match = url.match(/(?:twitter|x)\.com\/(?:#!\/)?(\w+)\/status(?:es)?\/(\d+)/i);
    return match?.[2] || null;
}; 