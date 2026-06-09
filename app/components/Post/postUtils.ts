/**
 * Utility functions and constants specific to the Post component.
 */

// Patterns for detecting embeddable URLs
export const TWITTER_PATTERN = /https?:\/\/((?:x|twitter)\.com\/\w+\/status\/\d+)[^\s]*/gi;
export const YOUTUBE_PATTERN = /https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?v=[^&\s]+|youtu\.be\/[^&\s]+)[^\s]*/gi;
export const DEXSCREENER_PATTERN = /https?:\/\/(?:www\.)?dexscreener\.com\/([^/\s]+)\/([^/\s?&]+)[^\s]*/gi;
// LINK_PATTERN handles markdown-style links and excludes other embed types
export const LINK_PATTERN = /(?:\[([^\]]*)\])?\(?https?:\/\/(?!(?:www\.)?(?:twitter\.com|x\.com|youtube\.com|youtu\.be|dexscreener\.com))([^\s)]+)\)?/gi;

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