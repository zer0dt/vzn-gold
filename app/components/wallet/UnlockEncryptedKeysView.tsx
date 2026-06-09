'use client'

import type React from 'react'
import { useRef, useState, useEffect } from 'react'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import { useWallet } from '@/app/hooks/use-wallet'
import { ArrowRight, ChevronDown, Fingerprint, Loader2, Lock, Sparkles, X } from 'lucide-react'

interface UnlockEncryptedKeysViewProps {
  onUnlocked?: () => void
}

const GOLD_TEXT =
  'text-transparent bg-clip-text bg-gradient-to-r from-[#FBBF24] via-[#F59E0B] to-[#FBBF24]'

const PRIMARY_CTA =
  'group relative inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-full bg-gradient-to-r from-amber-400 via-amber-500 to-amber-400 px-6 py-3 text-sm font-semibold text-black shadow-[0_10px_30px_-10px_rgba(245,158,11,0.55)] transition-all hover:scale-[1.01] hover:shadow-[0_14px_40px_-10px_rgba(245,158,11,0.75)] disabled:pointer-events-none disabled:opacity-60'

const PRIMARY_CTA_HOVER_OVERLAY =
  'absolute inset-0 bg-gradient-to-r from-amber-300 via-amber-200 to-amber-300 opacity-0 transition-opacity group-hover:opacity-100'

let passkeysModulePromise: Promise<typeof import('@/app/lib/passkeys')> | null = null
const loadPasskeysModule = () => {
  if (!passkeysModulePromise) {
    passkeysModulePromise = import('@/app/lib/passkeys')
  }
  return passkeysModulePromise
}

export default function UnlockEncryptedKeysView({ onUnlocked }: UnlockEncryptedKeysViewProps) {
  const {
    unlockWithPassword,
    profileOwnerAddress,
    profilePaymentAddress,
  } = useWallet()
  const [password, setPassword] = useState('')
  const [isUnlocking, setIsUnlocking] = useState(false)
  const [isPasskeyUnlocking, setIsPasskeyUnlocking] = useState(false)
  const [progress, setProgress] = useState<number>(0)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<number | null>(null)
  
  // Passkey state
  const [passkeysSupported, setPasskeysSupported] = useState(false)
  const [hasPasskeyForWallet, setHasPasskeyForWallet] = useState(false)
  const [walletPasskeys, setWalletPasskeys] = useState<Array<{ id: string; name: string; createdAt: number }>>([])
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [isPasswordExpanded, setIsPasswordExpanded] = useState(false)

  // If a passkey is available, the password form is optional — keep it hidden
  // until the user opts in. Otherwise we must show it (it's the only way in).
  const showPasswordSection = isPasswordExpanded || !passkeysSupported || !hasPasskeyForWallet

  // Check passkey support and existing passkeys
  useEffect(() => {
    let isMounted = true
    const hydratePasskeyState = async () => {
      if (typeof window === 'undefined' || !profileOwnerAddress) return
      const passkeys = await loadPasskeysModule()
      const supported = passkeys.isPasskeyAvailable()
      if (!isMounted) return
      setPasskeysSupported(supported)
      if (supported) {
        setHasPasskeyForWallet(passkeys.hasWalletPasskey(profileOwnerAddress))
        setWalletPasskeys(passkeys.getWalletPasskeysForAddress(profileOwnerAddress))
      }
    }
    void hydratePasskeyState()
    return () => {
      isMounted = false
    }
  }, [profileOwnerAddress])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && password && !isUnlocking && !isPasskeyUnlocking) {
      e.preventDefault()
      handleUnlock()
    }
  }

  const handleUnlock = async () => {
    if (!password) return
    setIsUnlocking(true)
    setProgress(0)
    setError(null)
    try {
      const start = Date.now()
      const totalMs = 10000
      intervalRef.current = window.setInterval(() => {
        const elapsed = Date.now() - start
        const pct = Math.min(100, Math.floor((elapsed / totalMs) * 100))
        setProgress(pct)
        if (pct >= 100 && intervalRef.current) {
          window.clearInterval(intervalRef.current)
          intervalRef.current = null
        }
      }, 100)

      const res = await unlockWithPassword(password)
      if (res.success) {
        setProgress(100)
        // Store password securely for passkey save prompt (encrypted, cleared after use)
        if (passkeysSupported && !hasPasskeyForWallet && profileOwnerAddress) {
          const passkeys = await loadPasskeysModule()
          await passkeys.storeTempPassword(password)
        } else {
          const passkeys = await loadPasskeysModule()
          passkeys.clearTempPassword()
        }
        onUnlocked?.()
      } else {
        const passkeys = await loadPasskeysModule()
        passkeys.clearTempPassword()
        setError('Incorrect password. Please try again.')
      }
    } catch (e) {
      const passkeys = await loadPasskeysModule()
      passkeys.clearTempPassword()
      setError('Failed to unlock wallet')
    } finally {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      setIsUnlocking(false)
    }
  }

  const handlePasskeyUnlock = async () => {
    if (!profileOwnerAddress) return
    setIsPasskeyUnlocking(true)
    setError(null)
    
    try {
      const passkeys = await loadPasskeysModule()
      const { password: storedPassword } = await passkeys.getWalletPasskey(profileOwnerAddress)
      
      // Now use the password to unlock
      setProgress(0)
      const start = Date.now()
      const totalMs = 10000
      intervalRef.current = window.setInterval(() => {
        const elapsed = Date.now() - start
        const pct = Math.min(100, Math.floor((elapsed / totalMs) * 100))
        setProgress(pct)
        if (pct >= 100 && intervalRef.current) {
          window.clearInterval(intervalRef.current)
          intervalRef.current = null
        }
      }, 100)

      const res = await unlockWithPassword(storedPassword)
      if (res.success) {
        setProgress(100)
        onUnlocked?.()
      } else {
        setError('Passkey unlock failed. Password may have changed. Please use your password.')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Passkey authentication failed'
      if (!message.toLowerCase().includes('cancel') && !message.toLowerCase().includes('abort')) {
        setError(message)
      }
    } finally {
      if (intervalRef.current) {
        window.clearInterval(intervalRef.current)
        intervalRef.current = null
      }
      setIsPasskeyUnlocking(false)
    }
  }

  const refreshPasskeys = () => {
    const refresh = async () => {
      if (!profileOwnerAddress) return
      const passkeys = await loadPasskeysModule()
      const updated = passkeys.getWalletPasskeysForAddress(profileOwnerAddress)
      setWalletPasskeys(updated)
      setHasPasskeyForWallet(updated.length > 0)
    }
    void refresh()
  }

  const isBusy = isUnlocking || isPasskeyUnlocking

  return (
    <div className="flex min-h-screen flex-col items-center p-4 md:justify-start md:pt-8">
      <div className="relative mt-8 w-full max-w-md overflow-hidden rounded-2xl border border-border/60 bg-background/95 p-6 shadow-[0_0_0_1px_rgba(245,158,11,0.2),0_20px_50px_-20px_rgba(0,0,0,0.55)] backdrop-blur-xl sm:p-7">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/60 to-transparent"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-28 left-1/2 h-56 w-56 -translate-x-1/2 rounded-full bg-amber-400/15 blur-3xl"
        />

        <div className="relative flex flex-col items-center gap-3 text-center">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-amber-600 dark:text-amber-300">
            <Lock className="h-3 w-3" />
            Vault · locked
          </div>
          <h2 className="font-vzn-headings text-2xl font-normal tracking-tight sm:text-3xl">
            Unlock your <span className={GOLD_TEXT}>keys</span>
          </h2>
          <p className="max-w-[320px] text-sm text-muted-foreground">
            Decrypt the owner and payment keys for this wallet. Everything happens in your browser.
          </p>
        </div>

        <div className="relative mt-6 space-y-4">
          <div className="overflow-hidden rounded-2xl border border-border/60 bg-background/60 p-4 backdrop-blur">
            <div className="space-y-3 text-xs sm:text-sm">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Owner address
                </p>
                <p className="mt-1 break-all font-mono text-foreground/90">
                  {profileOwnerAddress || 'Not set'}
                </p>
              </div>
              <div className="h-px bg-border/60" />
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Payment address
                </p>
                <p className="mt-1 break-all font-mono text-foreground/90">
                  {profilePaymentAddress || 'Not set'}
                </p>
              </div>
            </div>
          </div>

          {passkeysSupported && hasPasskeyForWallet && (
            <div className="relative overflow-hidden rounded-2xl border border-amber-400/30 bg-gradient-to-b from-amber-400/[0.08] to-amber-400/[0.02] p-4 backdrop-blur">
              <div
                aria-hidden
                className="pointer-events-none absolute -top-12 right-0 h-28 w-28 rounded-full bg-amber-400/15 blur-3xl"
              />
              <div className="relative mb-3 flex items-center gap-2">
                <span className="inline-flex h-7 w-7 items-center justify-center rounded-xl border border-amber-400/40 bg-amber-400/10 text-amber-500 dark:text-amber-300">
                  <Fingerprint className="h-3.5 w-3.5" />
                </span>
                <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-amber-600 dark:text-amber-300">
                  Quick unlock
                </span>
                {walletPasskeys.length > 1 && (
                  <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    {walletPasskeys.length} keys
                  </span>
                )}
              </div>

              <div className="relative mb-3 space-y-1.5">
                {walletPasskeys.map((pk) => (
                  <div
                    key={pk.id}
                    className="group flex items-center justify-between rounded-xl border border-border/50 bg-background/60 px-3 py-2 text-xs transition-colors hover:border-border"
                  >
                    {confirmDeleteId === pk.id ? (
                      <div className="flex w-full items-center justify-between gap-2">
                        <span className="text-[10px] text-red-500">Remove this passkey?</span>
                        <div className="flex gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              const remove = async () => {
                                const passkeys = await loadPasskeysModule()
                                passkeys.removeWalletPasskey(pk.id)
                                refreshPasskeys()
                                setConfirmDeleteId(null)
                              }
                              void remove()
                            }}
                            className="rounded bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-500 hover:bg-red-500/20 hover:text-red-600"
                          >
                            Yes
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground"
                          >
                            No
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="h-2 w-2 shrink-0 rounded-full bg-amber-400" />
                          <span className="truncate text-muted-foreground">{pk.name}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(pk.id)}
                          className="ml-2 p-0.5 text-muted-foreground/50 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                          title="Remove passkey"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>

              <button
                type="button"
                onClick={handlePasskeyUnlock}
                className={PRIMARY_CTA}
                disabled={isBusy}
              >
                <span className={PRIMARY_CTA_HOVER_OVERLAY} />
                <span className="relative flex items-center gap-2">
                  {isPasskeyUnlocking ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Unlocking…
                    </>
                  ) : (
                    <>
                      <Fingerprint className="h-4 w-4" />
                      Unlock with passkey
                    </>
                  )}
                </span>
              </button>

              <p className="relative mt-3 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Stored locally · Device-bound
              </p>
            </div>
          )}

          {passkeysSupported && hasPasskeyForWallet && (
            <button
              type="button"
              onClick={() => setIsPasswordExpanded((value) => !value)}
              aria-expanded={isPasswordExpanded}
              aria-controls="unlock-password-section"
              className="group flex w-full items-center gap-3 rounded-xl px-1 py-1 text-left font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-60"
              disabled={isBusy}
            >
              <span className="h-px flex-1 bg-border/60" />
              <span className="flex items-center gap-1.5">
                {isPasswordExpanded ? 'Hide password' : 'Use password instead'}
                <ChevronDown
                  className={`h-3 w-3 transition-transform ${isPasswordExpanded ? 'rotate-180' : ''}`}
                />
              </span>
              <span className="h-px flex-1 bg-border/60" />
            </button>
          )}

          {showPasswordSection && (
            <div
              id="unlock-password-section"
              className={`space-y-4 ${passkeysSupported && hasPasskeyForWallet ? 'animate-in fade-in slide-in-from-top-1 duration-200 ease-out' : ''}`}
            >
              <div className="space-y-2">
                <Label htmlFor="unlockPass" className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  Password
                </Label>
                <Input
                  id="unlockPass"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Enter your password"
                  className="h-11 rounded-xl border-border/70 bg-background/70 backdrop-blur focus-visible:border-amber-400/60 focus-visible:ring-amber-400/30"
                  disabled={isBusy}
                  autoFocus={isPasswordExpanded && passkeysSupported && hasPasskeyForWallet}
                />
              </div>

              {error && (
                <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
              )}

              <button
                type="button"
                onClick={handleUnlock}
                className={PRIMARY_CTA}
                disabled={!password || isBusy}
              >
                <span className={PRIMARY_CTA_HOVER_OVERLAY} />
                <span className="relative flex items-center gap-2">
                  {isUnlocking ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Decrypting… {progress}%
                    </>
                  ) : (
                    <>
                      Unlock
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </>
                  )}
                </span>
              </button>

              {isBusy && progress > 0 && (
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/60">
                  <div
                    className="h-full bg-gradient-to-r from-amber-300 via-amber-400 to-amber-500 transition-[width] duration-150"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {!showPasswordSection && error && (
            <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
          )}

          {!showPasswordSection && isBusy && progress > 0 && (
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/60">
              <div
                className="h-full bg-gradient-to-r from-amber-300 via-amber-400 to-amber-500 transition-[width] duration-150"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}

          <p className="pt-2 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            <Sparkles className="mr-1 inline h-3 w-3 align-[-2px]" />
            Keys decrypt locally in your browser
          </p>
        </div>
      </div>
    </div>
  )
}

