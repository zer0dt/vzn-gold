'use client'

import { Button } from "@/app/components/ui/button"
import { useAuth } from '@/app/contexts/AuthContext';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import AuthModal from './AuthModal';

interface LoginButtonProps {
  // When provided, login click will call this instead of opening internal modal
  // Useful when parent needs to manage modal outside of a dropdown
  onLoginClick?: () => void;
}

export default function LoginButton({ onLoginClick }: LoginButtonProps) {
  const { user, logout, isLoading } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    setMounted(true);
  }, []);

  // Avoid SSR/client mismatch: render nothing until mounted so SSR and first client render match
  if (!mounted) return null;

  const handleClick = async () => {
    if (user) {
      await logout();
      // Redirect away from protected pages after logout
      if (pathname === '/profile' || pathname === '/wallet') {
        router.push('/');
      }
    } else {
      // If parent provided a callback, use that (for dropdown scenarios)
      if (onLoginClick) {
        onLoginClick();
      } else {
        // Otherwise use internal modal
        setShowAuthModal(true);
      }
    }
  };

  return (
    <>
      <Button
        variant="outline"
        className="px-4 py-2 sm:px-6 sm:py-2 flex bg-transparent hover:bg-amber-400/10 items-center justify-center space-x-2 font-sans rounded-full
                   border-2 border-amber-400 focus:border-amber-400
                   focus:ring-2 focus:ring-amber-400/45 focus:ring-offset-0
                   transition-colors duration-200 ease-in-out animate-pulse-orange"
        onClick={handleClick}
        disabled={isLoading}
      >
        {isLoading
          ? 'Loading...'
          : user
            ? 'Logout'
            : 'Login'
        }
      </Button>

      {/* Only render internal modal if not using external callback */}
      {!onLoginClick && (
        <AuthModal open={showAuthModal} onOpenChange={setShowAuthModal} />
      )}
    </>
  )
} 