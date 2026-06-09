'use client'

import { useEffect, useRef, useState } from "react"
import { Camera, Wallet, Newspaper, Loader2, Trophy, LogOut } from "lucide-react"
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from "@/app/components/ui/button"
import { Avatar, AvatarImage, AvatarFallback } from "@/app/components/ui/avatar"
import { ModeToggle } from '@/app/components/ui/mode-toggle'
import PostSheet from "@/app/components/PostSheet"
import LoginButton from './LoginButton'
import AuthModal from './AuthModal'
import { useAuth } from '@/app/contexts/AuthContext'
import { useBlockHeightContext } from "@/app/contexts/BlockHeightContext"
import { useWallet } from '@/app/hooks/use-wallet'
import { useBSVPrice } from "@/app/hooks/use-bsv-price"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator
} from "@/app/components/ui/dropdown-menu"
import { formatCompactSupply } from "@/app/lib/formatCompactSupply"
import { formatTokenTicker } from "@/app/lib/formatTokenTicker"
import { vznGoldTitleGradientClassName } from "@/app/lib/vznGoldTitleGradient"
import { useNetworkStats } from "@/app/hooks/use-network-stats"

export default function FloatingProfileButton() {
  const { user, logout, isLoading: isAuthLoading } = useAuth();
  const { blockHeight } = useBlockHeightContext();
  const { bsvPrice, isLoading: isPriceLoading } = useBSVPrice();
  const router = useRouter()
  const pathname = usePathname()
  const modeToggleRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [showPostSheet, setShowPostSheet] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isAnyAuthModalOpen, setIsAnyAuthModalOpen] = useState(false);

  const { data: networkStats, isLoading: isNetworkStatsLoading } = useNetworkStats({
    enabled: isMenuOpen,
  });
  const tokenTicker =
    networkStats && !isNetworkStatsLoading ? formatTokenTicker(networkStats.symbol) : '';

  const {
    isWalletInitialized,
    ownerAddress,
    walletAddress,
    profileOwnerAddress,
    profilePaymentAddress,
    profileAvatarUrl,
    isFetchingProfile,
  } = useWallet();

  const handlePostSheetClose = () => {
    setShowPostSheet(false);
    setTimeout(() => {
      triggerRef.current?.focus();
    }, 50);
  }

  const handleLogout = async () => {
    setIsMenuOpen(false);
    await logout();

    if (pathname === '/profile' || pathname === '/wallet') {
      router.push('/');
    }
  };

  useEffect(() => {
    const syncAuthModalVisibility = () => {
      setIsAnyAuthModalOpen(document.body.dataset.authModalOpen === 'true');
    };

    syncAuthModalVisibility();
    window.addEventListener('auth-modal-visibility-change', syncAuthModalVisibility);

    return () => {
      window.removeEventListener('auth-modal-visibility-change', syncAuthModalVisibility);
    };
  }, []);

  useEffect(() => {
    if (isAnyAuthModalOpen) {
      setIsMenuOpen(false);
    }
  }, [isAnyAuthModalOpen]);

  let badgeColor = '';

  if (isAuthLoading) {
    badgeColor = '';
  } else if (!user) {
    badgeColor = 'red';
  } else if (isFetchingProfile) {
    badgeColor = '';
  } else {
    if (!profileOwnerAddress) {
      badgeColor = 'red';
    } else {
      const localWalletMatchesProfile =
        isWalletInitialized &&
        ownerAddress === profileOwnerAddress &&
        walletAddress === profilePaymentAddress;

      if (localWalletMatchesProfile) {
        badgeColor = 'green';
      } else {
        badgeColor = 'red';
      }
    }
  }

  return (
    <>
      {!isAnyAuthModalOpen && (
        <DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              ref={triggerRef}
              variant="ghost"
              size="icon"
              className="h-14 w-14 rounded-full border border-amber-400/40 bg-background/70 backdrop-blur shadow-[0_0_0_1px_rgba(245,158,11,0.15),0_14px_30px_-12px_rgba(245,158,11,0.45)] hover:border-amber-400/70 hover:shadow-[0_0_0_1px_rgba(245,158,11,0.3),0_18px_40px_-12px_rgba(245,158,11,0.65)] transition-all z-[100] relative"
            >
              <Avatar
                className="h-full w-full ring-1 ring-border/60 bg-muted"
              >
                {profileAvatarUrl ? (
                  <AvatarImage src={profileAvatarUrl} alt="Profile Avatar" />
                ) : (
                  <>
                    <AvatarImage src="/default-avy.png" alt="Default Avatar" className="transition-opacity duration-200 dark:opacity-0" />
                    <AvatarImage src="/default-avy.png" alt="Default Avatar" className="absolute inset-0 transition-opacity duration-200 opacity-0 dark:opacity-100" />
                  </>
                )}
                <AvatarFallback className="bg-gray-200 dark:bg-gray-700 animate-pulse" />
              </Avatar>
              {/* Notification Badge */}
              {badgeColor && (
                <span
                  className={`absolute -top-1 -right-1 h-4 w-4 rounded-full border-2 border-background ${badgeColor === 'red' ? 'bg-red-500 shadow-[0_0_10px_2px_rgba(239,68,68,0.5)]' : 'bg-emerald-500 shadow-[0_0_10px_2px_rgba(16,185,129,0.5)]'} ${badgeColor === 'green' ? 'animate-pulse' : ''}`}
                  title={
                    !user ? 'Please log in' :
                    badgeColor === 'red' ? 'Wallet needs attention' :
                    'Wallet connected'
                  }
                />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            side="top"
            className="w-48 mb-2 rounded-2xl border border-border/60 bg-background/95 backdrop-blur-xl shadow-[0_0_0_1px_rgba(245,158,11,0.2),0_20px_50px_-20px_rgba(0,0,0,0.55)]"
            collisionPadding={20}
            style={{ zIndex: 55 }}
            sideOffset={10}
            forceMount
          >
            <div className="px-2 -my-2 flex justify-center items-center">
              <button
                type="button"
                onClick={() => {
                  setIsMenuOpen(false);
                  router.push('/landing');
                }}
                className="my-4 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                aria-label="Go to landing page"
              >
                <span
                  className={`text-xl font-normal font-vzn-headings ${vznGoldTitleGradientClassName}`}
                >
                  VZN.gold
                </span>
              </button>
            </div>
            <div className="mx-2 border-t border-border/60" />
            <div className="px-3 py-2">
              <div className="space-y-2 pb-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500/70 shadow-[0_0_8px_rgba(16,185,129,0.45)] animate-pulse" />
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Block Height</span>
                  </div>
                  {blockHeight ? (
                    <span className="font-mono tabular-nums text-[10px] text-foreground/90">
                      {blockHeight.toLocaleString()}
                    </span>
                  ) : (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-emerald-500/80" />
                  )}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400/80 shadow-[0_0_8px_rgba(245,158,11,0.55)] animate-pulse" />
                    <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">sat price</span>
                  </div>
                  {!isPriceLoading && bsvPrice ? (
                    <span className="font-mono tabular-nums text-[10px] text-foreground/90">
                      ${(bsvPrice / 100000000).toFixed(8)}
                    </span>
                  ) : (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500/80" />
                  )}
                </div>
              </div>
              <div className="border-t border-border/60 pb-2" />
              {isNetworkStatsLoading || networkStats === null ? (
                <div className="flex h-10 items-center justify-center">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500/80" />
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="inline-block h-1.5 w-1.5 rounded-full bg-orange-500/80 shadow-[0_0_8px_rgba(249,115,22,0.55)] animate-pulse" />
                      <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Minted Supply</span>
                    </div>
                    <span className="font-mono tabular-nums text-[10px] text-foreground/90">
                      {networkStats.mintedPercentage.toFixed(2)}%
                    </span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full border border-border/60 bg-background/60 backdrop-blur">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-amber-300 via-amber-400 to-amber-500 shadow-[0_0_10px_-2px_rgba(245,158,11,0.7)] transition-[width] duration-500"
                      style={{ width: `${Math.min(networkStats.mintedPercentage, 100)}%` }}
                    />
                  </div>
                  <div
                    className="mt-1 text-right font-mono tabular-nums text-[10px] text-foreground/90"
                  >
                    {formatCompactSupply(networkStats.mintedTokens)} /{' '}
                    {formatCompactSupply(networkStats.totalTokens)}
                    {tokenTicker ? ` ${tokenTicker}` : ''}
                  </div>
                </>
              )}
            </div>
            <div className="mx-2 border-t border-border/60" />
            <DropdownMenuItem
              onClick={() => router.push('/')}
              className="rounded-lg py-2 group hover:bg-amber-400/10 hover:text-amber-600 focus:bg-amber-400/10 focus:text-amber-600 dark:hover:text-amber-300 dark:focus:text-amber-300 transition-colors"
            >
               <Newspaper className="mr-2 h-4 w-4" />
               <span className="text-sm font-sans">Feed</span>
            </DropdownMenuItem>

            {user && (
              <DropdownMenuItem
                onClick={() => router.push('/profile')}
                className="rounded-lg py-2 group hover:bg-amber-400/10 hover:text-amber-600 focus:bg-amber-400/10 focus:text-amber-600 dark:hover:text-amber-300 dark:focus:text-amber-300 transition-colors"
              >
                <Camera className="mr-2 h-4 w-4" />
                <span className="text-sm font-sans">Profile</span>
              </DropdownMenuItem>
            )}

            {user && (
              <DropdownMenuItem
                 onClick={() => router.push('/wallet')}
                 className="rounded-lg py-2 group hover:bg-amber-400/10 hover:text-amber-600 focus:bg-amber-400/10 focus:text-amber-600 dark:hover:text-amber-300 dark:focus:text-amber-300 transition-colors flex items-center"
              >
                {/* Icon Wrapper for Badge Positioning */}
                <span className="relative mr-2">
                  {isFetchingProfile ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Wallet className="h-4 w-4" />
                      {/* Notification Badge */}
                      {badgeColor && (
                        <span
                          className={`absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full border border-background ${badgeColor === 'red' ? 'bg-red-500' : 'bg-emerald-500'}`}
                          title={
                            !user ? 'Please log in' :
                            badgeColor === 'red' ? 'Wallet needs attention' :
                            'Wallet connected'
                          }
                        />
                      )}
                    </>
                  )}
                </span>
                 <span className="text-sm font-sans">Wallet</span>
               </DropdownMenuItem>
            )}

            <DropdownMenuItem
              onClick={() => router.push('/leaderboard')}
              className="rounded-lg py-2 group hover:bg-amber-400/10 hover:text-amber-600 focus:bg-amber-400/10 focus:text-amber-600 dark:hover:text-amber-300 dark:focus:text-amber-300 transition-colors"
            >
              <Trophy className="mr-2 h-4 w-4" />
              <span className="text-sm font-sans">Leaderboard</span>
            </DropdownMenuItem>

            <DropdownMenuSeparator className="bg-border/60" />

            <DropdownMenuItem
              className="rounded-lg py-2 group hover:bg-amber-400/10 hover:text-amber-600 focus:bg-amber-400/10 focus:text-amber-600 dark:hover:text-amber-300 dark:focus:text-amber-300 flex items-center gap-2 cursor-pointer transition-colors"
              onSelect={(event) => {
                event.preventDefault();
                modeToggleRef.current?.click();
              }}
            >
              <div className="mr-2 flex h-4 w-4 items-center justify-center">
                 <ModeToggle ref={modeToggleRef} />
              </div>
              <span className="text-sm font-sans">Toggle</span>
            </DropdownMenuItem>

            {user && (
              <DropdownMenuItem
                className="rounded-lg py-2 group hover:bg-amber-400/10 hover:text-amber-600 focus:bg-amber-400/10 focus:text-amber-600 dark:hover:text-amber-300 dark:focus:text-amber-300 transition-colors"
                onClick={handleLogout}
              >
                <LogOut className="mr-2 h-4 w-4" />
                <span className="text-sm font-sans">Logout</span>
              </DropdownMenuItem>
            )}

            <div className="px-3 py-1.5 text-center text-[11px] text-muted-foreground/70">
              <Link
                href="/terms"
                className="hover:text-foreground/90 transition-colors"
                onClick={() => setIsMenuOpen(false)}
              >
                Terms
              </Link>
              <span className="px-1.5">·</span>
              <Link
                href="/privacy"
                className="hover:text-foreground/90 transition-colors"
                onClick={() => setIsMenuOpen(false)}
              >
                Privacy
              </Link>
            </div>

            <DropdownMenuItem
              className="py-2 focus:bg-transparent flex justify-center items-center"
              onSelect={(event) => event.preventDefault()}
            >
              {user ? (
                <button
                  type="button"
                  className="inline-flex min-w-[160px] items-center justify-center rounded-full border-2 border-amber-400 bg-inherit px-6 py-2 text-sm font-semibold text-foreground transition-colors duration-200 ease-in-out animate-pulse-orange hover:bg-amber-400/10 focus:outline-none focus-visible:border-amber-400 focus-visible:ring-2 focus-visible:ring-amber-400/45"
                  onClick={() => {
                    setIsMenuOpen(false);
                    setShowPostSheet(true);
                  }}
                >
                  Post
                </button>
              ) : (
                <LoginButton
                  onLoginClick={() => {
                    setIsMenuOpen(false);
                    setShowAuthModal(true);
                  }}
                />
              )}
            </DropdownMenuItem>

          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <PostSheet 
        isOpen={showPostSheet} 
        onClose={handlePostSheetClose} 
      />

      {/* Auth modal rendered OUTSIDE dropdown to prevent conflicts */}
      <AuthModal open={showAuthModal} onOpenChange={setShowAuthModal} />
    </>
  )
} 