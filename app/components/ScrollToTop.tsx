'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

/**
 * Component that scrolls to top when mounted.
 * Add this to pages that should always start at the top.
 */
export function ScrollToTop() {
  const pathname = usePathname()
  
  useEffect(() => {
    // Scroll to top when the component mounts (page loads)
    window.scrollTo(0, 0)
  }, [pathname])
  
  return null
}
