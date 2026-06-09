'use client'

import { useRouter } from 'next/navigation'
import type { ReactNode } from 'react'

interface BackButtonProps {
  children?: ReactNode
}

export default function BackButton({ children }: BackButtonProps) {
  const router = useRouter()
  
  const handleBack = () => {
    router.back()
  }
  
  return (
    <button 
      onClick={handleBack} 
      className="flex items-center justify-center hover:bg-muted/50 rounded-full p-2 transition-colors"
      aria-label="Go back"
    >
      {children}
    </button>
  )
} 