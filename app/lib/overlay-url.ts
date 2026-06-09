const HAS_SCHEME = /^https?:\/\//i

function hostnameLooksLikeNgrok(hostname: string): boolean {
  return (
    hostname === 'ngrok-free.app' ||
    hostname.endsWith('.ngrok-free.app') ||
    hostname.endsWith('.ngrok.io') ||
    hostname.endsWith('.ngrok.app') ||
    hostname.includes('.ngrok.')
  )
}

/** Trim trailing slashes; prepend `https://` when no scheme so `fetch()` gets a valid absolute URL. */
export function normalizeOverlayBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '')
  if (!trimmed) {
    return 'http://127.0.0.1:8080'
  }
  if (HAS_SCHEME.test(trimmed)) {
    return trimmed
  }
  return `https://${trimmed}`
}

export function overlayHostLooksLikeNgrok(overlayUrl: string): boolean {
  try {
    return hostnameLooksLikeNgrok(new URL(normalizeOverlayBaseUrl(overlayUrl)).hostname)
  } catch {
    return false
  }
}

/**
 * ngrok free tier serves an HTML interstitial unless this header is set (server-side clients too).
 * @see https://ngrok.com/docs/guides/device-gateway/client/#bypass-warning-page
 */
export function overlayUpstreamHeaders(
  overlayUrl: string,
  headers?: Record<string, string>
): Record<string, string> {
  const merged = { ...headers }
  if (overlayHostLooksLikeNgrok(overlayUrl)) {
    merged['ngrok-skip-browser-warning'] = 'true'
  }
  return merged
}
