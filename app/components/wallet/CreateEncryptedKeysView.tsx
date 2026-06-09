'use client'

import React, { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/app/components/ui/card'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { Label } from '@/app/components/ui/label'
import { useWallet } from '@/app/hooks/use-wallet'
import { Separator } from '@/app/components/ui/separator'
import { Alert, AlertDescription, AlertTitle } from '@/app/components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle as DialogTitleUI,
} from '@/app/components/ui/dialog'
import { Lock, Shield, Key, Info } from 'lucide-react'
import { newPK, restoreWallet } from '@/app/lib/wallet-payment'
import { useToast } from '@/app/hooks/use-toast'
import { clearTempPassword, hasWalletPasskey, isPasskeyAvailable, storeTempPassword } from '@/app/lib/passkeys'

interface CreateEncryptedKeysViewProps {
  onSaved?: () => void
  onBack?: () => void
}

let cryptoModulePromise: Promise<{
  bsv: any
  bip38: any
  wif: any
}> | null = null

const loadCryptoModules = async () => {
  if (!cryptoModulePromise) {
    cryptoModulePromise = Promise.all([
      import('scrypt-ts'),
      import('@asoltys/bip38'),
      import('wif'),
    ]).then(([scryptTs, bip38Lib, wifLib]) => ({
      bsv: scryptTs.bsv,
      bip38: bip38Lib,
      wif: wifLib,
    }))
  }
  return cryptoModulePromise
}

export default function CreateEncryptedKeysView({ onSaved }: CreateEncryptedKeysViewProps) {
  const { isFetchingProfile, activeCredentialId, fetchProfileAddresses } = useWallet()
  const { toast } = useToast()
  const DEFAULT_SCRYPT_PARAMS = { N: 16384, r: 8, p: 8, asyncTickInterval: 25 } as const
  const [showForm, setShowForm] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [isEncrypting, setIsEncrypting] = useState(false)
  const [previewOwnerWif, setPreviewOwnerWif] = useState<string>('')
  const [previewPayWif, setPreviewPayWif] = useState<string>('')
  const [previewOwnerAddr, setPreviewOwnerAddr] = useState<string>('')
  const [previewPayAddr, setPreviewPayAddr] = useState<string>('')
  const [isEncrypted, setIsEncrypted] = useState<boolean>(false)
  const [encOwner, setEncOwner] = useState<string>('')
  const [encPay, setEncPay] = useState<string>('')
  const [isWarningOpen, setIsWarningOpen] = useState(false)

  const MIN_PASSWORD_LENGTH = 12
  const isPasswordLongEnough = password.length >= MIN_PASSWORD_LENGTH
  const passwordsMatch = password === confirm

  const generatePreview = async () => {
    const { bsv } = await loadCryptoModules()
    const ownerWif = newPK()
    const payWif = newPK()
    const ownerAddr = bsv.Address.fromPrivateKey(bsv.PrivateKey.fromWIF(ownerWif)).toString()
    const payAddr = bsv.Address.fromPrivateKey(bsv.PrivateKey.fromWIF(payWif)).toString()
    setPreviewOwnerWif(ownerWif)
    setPreviewPayWif(payWif)
    setPreviewOwnerAddr(ownerAddr)
    setPreviewPayAddr(payAddr)
  }

  React.useEffect(() => {
    void generatePreview()
  }, [])

  const encryptNow = async () => {
    if (!password || !isPasswordLongEnough || !passwordsMatch) {
      const message = !password
        ? 'Enter a password.'
        : !isPasswordLongEnough
          ? `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
          : 'Passwords do not match'
      toast({ variant: 'destructive', description: message, duration: 1500 })
      return
    }
    try {
      if (!previewOwnerWif || !previewPayWif) throw new Error('Missing keys to encrypt')
      // Flip UI state first, then yield to allow the button label to repaint before heavy work
      setIsEncrypting(true)
      await new Promise<void>((resolve) => {
        if (typeof window !== 'undefined' && 'requestAnimationFrame' in window) {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        } else {
          setTimeout(resolve, 0)
        }
      })

      const { wif, bip38 } = await loadCryptoModules()
      const { privateKey: ownerPriv, compressed: ownerCompressed } = wif.decode(previewOwnerWif)
      const { privateKey: payPriv, compressed: payCompressed } = wif.decode(previewPayWif)

      const norm = (pct: number) => {
        const normalized = pct <= 1 ? pct * 100 : pct
        const clamped = Math.max(0, Math.min(100, normalized))
        return Math.floor(clamped)
      }

      console.log('Starting BIP38 encryption for owner key...')
      const encOwnerStr: string = await (bip38 as any).encryptAsync(
        ownerPriv,
        ownerCompressed,
        password,
        (pct: number) => {
          console.log('BIP38 encrypt progress (owner):', norm(pct))
        },
        { ...DEFAULT_SCRYPT_PARAMS, asyncTickInterval: 25 }
      )
      console.log('Owner key encryption complete.')

      console.log('Starting BIP38 encryption for payment key...')
      const encPayStr: string = await (bip38 as any).encryptAsync(
        payPriv,
        payCompressed,
        password,
        (pct: number) => {
          console.log('BIP38 encrypt progress (payment):', norm(pct))
        },
        { ...DEFAULT_SCRYPT_PARAMS, asyncTickInterval: 25 }
      )
      console.log('Payment key encryption complete.')
      setEncOwner(encOwnerStr)
      setEncPay(encPayStr)
      setIsEncrypted(true)
    } catch (e) {
      console.error('encrypt error', e)
      toast({ variant: 'destructive', description: 'Failed to encrypt keys', duration: 1500 })
    } finally {
      setIsEncrypting(false)
    }
  }

  const handleEncryptClick = () => {
    if (!password || !isPasswordLongEnough || !passwordsMatch || isEncrypting) {
      // Let encryptNow handle validations/toasts if user bypasses, but show nothing here
      return encryptNow()
    }
    setIsWarningOpen(true)
  }

  const onSave = async () => {
    console.log('Saving encrypted keys to profile...')
    if (!isEncrypted || !encOwner || !encPay) {
      toast({ variant: 'destructive', description: 'Encrypt keys first', duration: 1500 })
      return
    }
    setIsSaving(true)
    try {
      // Yield to the browser so the button can repaint to "Saving..." before the request
      await new Promise<void>((resolve) => {
        if (typeof window !== 'undefined' && 'requestAnimationFrame' in window) {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
        } else {
          setTimeout(resolve, 0)
        }
      })
      const resp = await fetch('/api/profiles/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner_address: previewOwnerAddr,
          payment_address: previewPayAddr,
          passkey_credential_id: activeCredentialId ?? null,
          owner_key_bip38: encOwner,
          payment_key_bip38: encPay,
        })
      })
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}))
        throw new Error(err.error || 'Failed to save encrypted keys')
      }
      // Sync wallet context with latest profile
      await fetchProfileAddresses()
      console.log('Encrypted keys saved. Restoring local wallet state from in-memory WIFs...')
      try {
        restoreWallet(previewOwnerWif, previewPayWif)
        console.log('Local wallet state restored from sessionStorage.')
      } catch (e) {
        console.error('Failed to restore local wallet state after save:', e)
      }

      // Store password securely for passkey save prompt (encrypted, if supported)
      if (typeof window !== 'undefined' && isPasskeyAvailable() && !hasWalletPasskey(previewOwnerAddr)) {
        await storeTempPassword(password)
      } else {
        clearTempPassword()
      }

      setPassword('')
      setConfirm('')
      onSaved?.()
      setIsSaving(false)
    } catch (e) {
      setIsSaving(false)
      toast({ variant: 'destructive', description: (e as Error).message, duration: 2000 })
    }
  }

  return (
    <div className="flex flex-col items-center min-h-screen p-4 md:pt-8 md:justify-start">
      <Card className="w-full max-w-xl mt-8 bg-card border-amber-200/60 dark:border-amber-900/40 shadow-xl">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 flex items-center justify-center">
              <Lock className="h-5 w-5" />
            </div>
            <div>
              <CardTitle className="font-sans bg-gradient-to-r from-amber-400 to-amber-500 bg-clip-text text-transparent">Create your BIP38 Encrypted Keys</CardTitle>
            </div>
          </div>
        </CardHeader>
        <Separator className="bg-gray-200 dark:bg-gray-800" />
        <CardContent className="space-y-5 p-6">
          {!showForm ? (
            <>
              <p className="text-sm text-muted-foreground">Protect your wallet with a password so you can securely access it from any device.</p>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-lg border bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-800 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Key className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <p className="text-sm font-medium">What gets created</p>
                  </div>
                  <p className="text-sm text-muted-foreground">Owner and payment addresses, each with a private key.</p>
                </div>
                <div className="rounded-lg border bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-800 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <Shield className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <p className="text-sm font-medium">Why a password</p>
                  </div>
                  <p className="text-sm text-muted-foreground">Keys are encrypted using BIP‑38 (AES‑256 + scrypt).</p>
                </div>
                <div className="rounded-lg border bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-800 p-4 sm:col-span-2">
                  <div className="flex items-center gap-2 mb-2">
                    <Lock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <p className="text-sm font-medium">Where it’s stored</p>
                  </div>
                  <p className="text-sm text-muted-foreground">After encryption, only the BIP‑38 encrypted keys are saved to your profile on our servers — never your raw private keys or password. This lets you sign in from any device: we fetch the encrypted keys and decrypt them locally when you enter your password.</p>
                </div>
                <div className="rounded-lg border bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-800 p-4 sm:col-span-2">
                  <div className="flex items-center gap-2 mb-2">
                    <Key className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    <p className="text-sm font-medium">Key roles</p>
                  </div>
                  <ul className="text-sm text-muted-foreground space-y-1 list-disc pl-5">
                    <li><span className="text-foreground">Owner key</span>: signs bSocial posts and holds ownership of 1sat Ordinals.</li>
                    <li><span className="text-foreground">Payment key</span>: used to pay and to lock likes (your spending/lock address).</li>
                  </ul>
                </div>
                
              </div>
              <div className="h-px bg-gray-200 dark:bg-gray-800" />
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  className="border-amber-500 text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-400 dark:hover:bg-amber-950/30"
                  onClick={() => setShowForm(true)}
                >
                  Continue
                </Button>
              </div>
            </>
          ) : (
            <>
              <div>
                <div className="rounded-lg border bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-800 p-4 mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium">Preview keys & addresses</p>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="border-amber-500 text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-400 dark:hover:bg-amber-950/30"
                        onClick={generatePreview}
                      >
                        Refresh
                      </Button>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Owner address</p>
                      <p className="font-mono break-all text-xs sm:text-sm">{previewOwnerAddr}</p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Payment address</p>
                      <p className="font-mono break-all text-xs sm:text-sm">{previewPayAddr}</p>
                    </div>
                  </div>
                </div>
                <p className="text-sm font-medium mb-1">Set your password</p>
                <p className="text-xs text-muted-foreground mb-3">Both the owner and payment keys will be encrypted using the same password.</p>
                <div className="space-y-3">
                  <div className="space-y-1.5">
                    <Label className="font-sans" htmlFor="encPass">Password</Label>
                    <Input
                      id="encPass"
                      type="password"
                      placeholder="Enter a strong password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      minLength={MIN_PASSWORD_LENGTH}
                      aria-invalid={password.length > 0 && !isPasswordLongEnough}
                    />
                    <p className="text-xs text-muted-foreground">Use 12+ characters — a long, unique passphrase is best.</p>
                    {password.length > 0 && !isPasswordLongEnough && (
                      <p className="text-xs text-destructive">Password must be at least {MIN_PASSWORD_LENGTH} characters.</p>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <Label className="font-sans" htmlFor="encPassConfirm">Confirm password</Label>
                    <Input
                      id="encPassConfirm"
                      type="password"
                      placeholder="Re-enter your password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      aria-invalid={confirm.length > 0 && !passwordsMatch}
                    />
                    {confirm.length > 0 && !passwordsMatch && (
                      <p className="text-xs text-destructive">Passwords do not match.</p>
                    )}
                  </div>
                  <Alert className="bg-amber-50/60 dark:bg-amber-950/20 border-amber-200/60 dark:border-amber-900/40">
                    <div className="flex items-start gap-2">
                      <Info className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5" />
                      <div>
                        <AlertTitle className="text-sm">Important</AlertTitle>
                        <AlertDescription className="text-xs">
                          Your password is never stored and cannot be recovered. If you lose it, your encrypted keys cannot be decrypted and your funds and assets will be inaccessible.
                        </AlertDescription>
                      </div>
                    </div>
                  </Alert>
                </div>
                {isEncrypted && (
                  <div className="space-y-3">
                    <div className="mt-2 rounded-lg border bg-amber-50/60 dark:bg-amber-950/20 border-amber-200/60 dark:border-amber-900/40 p-4">
                      <p className="text-sm font-medium mb-2 text-amber-700 dark:text-amber-300">Encrypted keys (BIP‑38)</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                        <div className="space-y-1">
                          <p className="text-muted-foreground">Owner</p>
                          <p className="font-mono break-all">{encOwner}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-muted-foreground">Payment</p>
                          <p className="font-mono break-all">{encPay}</p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="flex justify-between gap-2 pt-2">
                <Button
                  variant="outline"
                  className="border-amber-500 text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-400 dark:hover:bg-amber-950/30"
                  onClick={() => { setShowForm(false); setIsEncrypted(false); setEncOwner(''); setEncPay('') }}
                  disabled={isSaving || isFetchingProfile || isEncrypting}
                >
                  Back
                </Button>
                {isEncrypted ? (
                  <Button
                    variant="outline"
                    className="border-amber-500 text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-400 dark:hover:bg-amber-950/30"
                    onClick={onSave}
                    disabled={isSaving}
                  >
                    {isSaving ? 'Saving...' : 'Finish'}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    className="border-amber-500 text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-400 dark:hover:bg-amber-950/30"
                    onClick={handleEncryptClick}
                    disabled={!isPasswordLongEnough || !passwordsMatch || isEncrypting}
                  >
                    {isEncrypting ? 'Encrypting...' : 'Encrypt'}
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Dialog open={isWarningOpen} onOpenChange={setIsWarningOpen}>
        <DialogContent className="max-w-md rounded-xl bg-card border-amber-200/60 dark:border-amber-900/40">
          <DialogHeader>
            <DialogTitleUI className="bg-gradient-to-r from-amber-400 to-amber-500 bg-clip-text text-transparent">Before you encrypt</DialogTitleUI>
            <DialogDescription className="text-sm">
              Your password is not stored anywhere and cannot be recovered. If you lose it, your encrypted keys cannot be decrypted and your funds and assets will be inaccessible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="pt-2 flex gap-2">
            <Button
              variant="outline"
              className="border-amber-500 text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-400 dark:hover:bg-amber-950/30"
              onClick={() => setIsWarningOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              className="border-amber-500 text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:border-amber-400 dark:hover:bg-amber-950/30"
              onClick={() => { setIsWarningOpen(false); encryptNow() }}
            >
              I understand, encrypt
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

