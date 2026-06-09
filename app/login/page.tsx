'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import AuthModal from '@/app/components/layout/AuthModal'
import { useAuth } from '@/app/contexts/AuthContext'

export default function LoginPage() {
  const router = useRouter()
  const { user, isLoading } = useAuth()
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(true)
  const userRef = useRef(user)
  const openedWhileSignedOutRef = useRef(false)
  const closeRedirectTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    userRef.current = user
  }, [user])

  useEffect(() => {
    if (!isLoading && !user) {
      openedWhileSignedOutRef.current = true
    }
  }, [isLoading, user])

  useEffect(() => {
    if (!isLoading && user) {
      if (closeRedirectTimeoutRef.current) {
        window.clearTimeout(closeRedirectTimeoutRef.current)
        closeRedirectTimeoutRef.current = null
      }
      // If sign-in happened inside the open auth modal, let that flow finish
      // so the passkey prompt can remain visible until the user chooses.
      if (openedWhileSignedOutRef.current && isAuthModalOpen) {
        return
      }
      router.replace('/wallet')
    }
  }, [isAuthModalOpen, isLoading, router, user])

  useEffect(() => {
    return () => {
      if (closeRedirectTimeoutRef.current) {
        window.clearTimeout(closeRedirectTimeoutRef.current)
      }
    }
  }, [])

  const handleOpenChange = (open: boolean) => {
    setIsAuthModalOpen(open)

    if (!open && !user) {
      closeRedirectTimeoutRef.current = window.setTimeout(() => {
        if (!userRef.current) {
          router.push('/')
        }
      }, 150)
    }
  }

  return (
    <div className="min-h-screen">
      <AuthModal open={isAuthModalOpen} onOpenChange={handleOpenChange} />
    </div>
  )
}
