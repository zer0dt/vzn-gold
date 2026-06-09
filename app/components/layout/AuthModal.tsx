'use client'

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/app/contexts/AuthContext';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/app/components/ui/dialog';
import { Input } from '@/app/components/ui/input';
import { Label } from '@/app/components/ui/label';
import { ArrowLeft, ArrowRight, CheckCircle2, Fingerprint, Loader2, Lock, Mail, Sparkles, User, X } from 'lucide-react';
import { 
  isPasskeyAvailable, 
  getAuthPasskey, 
  createAuthPasskey,
  getAuthPasskeys,
  removeAuthPasskey
} from '@/app/lib/passkeys';

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const GOLD_TEXT =
  'text-transparent bg-clip-text bg-gradient-to-r from-[#FBBF24] via-[#F59E0B] to-[#FBBF24]';

const PRIMARY_CTA =
  'group relative inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-full bg-gradient-to-r from-amber-400 via-amber-500 to-amber-400 px-6 py-3 text-sm font-semibold text-black shadow-[0_10px_30px_-10px_rgba(245,158,11,0.55)] transition-all hover:scale-[1.01] hover:shadow-[0_14px_40px_-10px_rgba(245,158,11,0.75)] disabled:pointer-events-none disabled:opacity-60';

const PRIMARY_CTA_HOVER_OVERLAY =
  'absolute inset-0 bg-gradient-to-r from-amber-300 via-amber-200 to-amber-300 opacity-0 transition-opacity group-hover:opacity-100';

const GHOST_PILL =
  'group inline-flex w-full items-center justify-center gap-2 rounded-full border border-border/70 bg-background/60 px-6 py-3 text-sm font-medium text-foreground backdrop-blur transition-colors hover:border-foreground/30 hover:bg-background disabled:pointer-events-none disabled:opacity-60';

const VIEW_ANIMATION_IN =
  'animate-in fade-in slide-in-from-right-2 duration-200 ease-out';

const VIEW_ANIMATION_BACK =
  'animate-in fade-in slide-in-from-left-2 duration-200 ease-out';

function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

type AuthView = 'main' | 'email-signin' | 'email-signup' | 'save-passkey';

export default function AuthModal({ open, onOpenChange }: AuthModalProps) {
  const { signInWithEmail, signUpWithEmail, signInWithGoogle } = useAuth();
  const router = useRouter();
  
  const [view, setView] = useState<AuthView>('main');
  const [activeTab, setActiveTab] = useState<'signin' | 'signup'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isPasskeySubmitting, setIsPasskeySubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  
  // Passkey state
  const [passkeysSupported, setPasskeysSupported] = useState(false);
  const [hasStoredPasskeys, setHasStoredPasskeys] = useState(false);
  const [storedPasskeysList, setStoredPasskeysList] = useState<Array<{ id: string; email: string; name: string }>>([]);
  const [pendingPasskeyData, setPendingPasskeyData] = useState<{
    email: string;
    password: string;
    name: string;
    redirectToWallet: boolean;
  } | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [selectedPasskeyId, setSelectedPasskeyId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || typeof window === 'undefined') {
      return;
    }

    const { body } = document;
    const currentCount = Number(body.dataset.authModalOpenCount ?? '0');
    const nextCount = currentCount + 1;

    body.dataset.authModalOpen = 'true';
    body.dataset.authModalOpenCount = String(nextCount);
    window.dispatchEvent(new CustomEvent('auth-modal-visibility-change'));

    return () => {
      const updatedCount = Math.max(0, Number(body.dataset.authModalOpenCount ?? '1') - 1);

      if (updatedCount === 0) {
        delete body.dataset.authModalOpen;
        delete body.dataset.authModalOpenCount;
      } else {
        body.dataset.authModalOpen = 'true';
        body.dataset.authModalOpenCount = String(updatedCount);
      }

      window.dispatchEvent(new CustomEvent('auth-modal-visibility-change'));
    };
  }, [open]);

  // Check for passkey support and stored passkeys on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const supported = isPasskeyAvailable();
      setPasskeysSupported(supported);
      if (supported) {
        const passkeys = getAuthPasskeys();
        setHasStoredPasskeys(passkeys.length > 0);
        setStoredPasskeysList(passkeys);
        // Auto-select the first (most recent) passkey
        if (passkeys.length > 0 && !selectedPasskeyId) {
          setSelectedPasskeyId(passkeys[0].id);
        }
      }
    }
  }, [open]);

  const resetForm = () => {
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setDisplayName('');
    setError(null);
    setSuccessMessage(null);
    setPendingPasskeyData(null);
    setConfirmDeleteId(null);
    setSelectedPasskeyId(null);
  };

  const goBackToMain = () => {
    setError(null);
    setView('main');
  };

  const handleClose = () => {
    resetForm();
    setView('main');
    setActiveTab('signin');
    onOpenChange(false);
  };

  // Handle passkey sign-in
  const handlePasskeySignIn = async () => {
    setIsPasskeySubmitting(true);
    setError(null);
    
    try {
      // Pass the selected credential ID if one is selected
      const authData = await getAuthPasskey(selectedPasskeyId || undefined);
      const result = await signInWithEmail(authData.email, authData.password);
      
      if (result.success) {
        router.push('/wallet');
        handleClose();
      } else {
        setError(result.error || 'Sign in failed. Your password may have changed.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Passkey authentication failed';
      // Don't show "user cancelled" errors as real errors
      if (!message.toLowerCase().includes('cancel') && !message.toLowerCase().includes('abort')) {
        setError(message);
      }
    } finally {
      setIsPasskeySubmitting(false);
    }
  };

  const offerPasskeySetup = ({
    email,
    password,
    name,
    redirectToWallet,
  }: {
    email: string;
    password: string;
    name: string;
    redirectToWallet: boolean;
  }) => {
    const existingPasskeys = getAuthPasskeys();
    const hasExistingForEmail = existingPasskeys.some(p => p.email === email);

    if (passkeysSupported && !hasExistingForEmail) {
      setPendingPasskeyData({ email, password, name, redirectToWallet });
      setView('save-passkey');
      return true;
    }

    return false;
  };

  // Save passkey after successful login
  const handleSavePasskey = async () => {
    if (!pendingPasskeyData) return;
    
    setIsSubmitting(true);
    setError(null);
    
    try {
      await createAuthPasskey({
        email: pendingPasskeyData.email,
        password: pendingPasskeyData.password,
        name: pendingPasskeyData.name || pendingPasskeyData.email
      });
      if (pendingPasskeyData.redirectToWallet) {
        router.push('/wallet');
      }
      handleClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save passkey';
      if (!message.toLowerCase().includes('cancel') && !message.toLowerCase().includes('abort')) {
        setError(message);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSkipPasskey = () => {
    if (pendingPasskeyData?.redirectToWallet) {
      router.push('/wallet');
    }
    handleClose();
  };

  const handleGoogleSignIn = async () => {
    setIsGoogleLoading(true);
    setError(null);
    const result = await signInWithGoogle();
    if (!result.success) {
      setError(result.error ?? 'Google sign-in failed');
      setIsGoogleLoading(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError('Please fill in all fields');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const result = await signInWithEmail(email, password);
    
    if (result.success) {
      if (offerPasskeySetup({ email, password, name: email, redirectToWallet: true })) {
        setIsSubmitting(false);
      } else {
        router.push('/wallet');
        handleClose();
      }
    } else {
      setError(result.error || 'Sign in failed');
      setIsSubmitting(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || !confirmPassword || !displayName) {
      setError('Please fill in all fields');
      return;
    }

    if (displayName.length < 2) {
      setError('Display name must be at least 2 characters');
      return;
    }

    if (displayName.length > 50) {
      setError('Display name must be less than 50 characters');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const result = await signUpWithEmail(email, password, displayName);
    
    if (result.success) {
      if (result.needsConfirmation) {
        setSuccessMessage('Check your email for a confirmation link to complete your registration.');
        resetForm();
        setView('main');
      } else if (offerPasskeySetup({ email, password, name: displayName, redirectToWallet: true })) {
        setIsSubmitting(false);
      } else {
        router.push('/wallet');
        handleClose();
      }
    } else {
      setError(result.error || 'Sign up failed');
    }
    
    setIsSubmitting(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="overflow-hidden rounded-2xl border-border/60 bg-background/95 shadow-[0_0_0_1px_rgba(245,158,11,0.2),0_20px_50px_-20px_rgba(0,0,0,0.55)] backdrop-blur-xl sm:max-w-[440px]"
        onEscapeKeyDown={(event) => {
          if (view === 'email-signin' || view === 'email-signup') {
            event.preventDefault();
            goBackToMain();
          }
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/60 to-transparent"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-28 left-1/2 h-56 w-56 -translate-x-1/2 rounded-full bg-amber-400/15 blur-3xl"
        />
        {view === 'save-passkey' ? (
          <>
            <DialogHeader className="relative">
              <div className="mx-auto inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-amber-600 dark:text-amber-300">
                <Sparkles className="h-3 w-3" />
                Faster next time
              </div>
              <DialogTitle className="mt-3 text-center font-vzn-headings text-2xl font-normal tracking-tight sm:text-3xl">
                Save a <span className={GOLD_TEXT}>passkey</span>
              </DialogTitle>
              <DialogDescription className="text-center text-sm text-muted-foreground">
                Sign in with Face ID, Touch ID, or your device PIN — no password typing.
              </DialogDescription>
            </DialogHeader>

            <div className="relative flex flex-col items-center gap-5 pt-2 pb-2">
              <div className="relative">
                <div
                  aria-hidden
                  className="absolute inset-0 rounded-2xl bg-amber-400/20 blur-xl"
                />
                <div className="relative inline-flex h-16 w-16 items-center justify-center rounded-2xl border border-amber-400/40 bg-gradient-to-b from-amber-400/20 to-amber-400/[0.04] text-amber-500 dark:text-amber-300">
                  <Fingerprint className="h-8 w-8" />
                </div>
              </div>

              <p className="max-w-[320px] text-center text-sm text-muted-foreground">
                Your passkey stays on this device. No shared secret leaves your browser.
              </p>

              {error && (
                <p className="text-sm text-red-500 dark:text-red-400">{error}</p>
              )}

              <div className="mt-1 flex w-full flex-col gap-2">
                <button
                  type="button"
                  onClick={handleSavePasskey}
                  className={PRIMARY_CTA}
                  disabled={isSubmitting}
                >
                  <span className={PRIMARY_CTA_HOVER_OVERLAY} />
                  <span className="relative flex items-center gap-2 transition-colors group-hover:text-black">
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Setting up…
                      </>
                    ) : (
                      <>
                        <Fingerprint className="h-4 w-4" />
                        Save passkey
                      </>
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={handleSkipPasskey}
                  className={GHOST_PILL}
                  disabled={isSubmitting}
                >
                  Skip for now
                </button>
              </div>
            </div>
          </>
        ) : view === 'email-signin' || view === 'email-signup' ? (
          <div className={`relative ${VIEW_ANIMATION_IN}`}>
            <DialogHeader className="relative">
              <button
                type="button"
                onClick={goBackToMain}
                className="group absolute -left-1 top-0 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                aria-label="Back"
                disabled={isSubmitting}
              >
                <ArrowLeft className="h-3.5 w-3.5 transition-transform group-hover:-translate-x-0.5" />
                Back
              </button>

              <div className="mx-auto inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-amber-600 dark:text-amber-300">
                <Mail className="h-3 w-3" />
                {view === 'email-signin' ? 'Email sign-in' : 'Create account'}
              </div>
              <DialogTitle className="mt-3 text-center font-vzn-headings text-2xl font-normal tracking-tight sm:text-3xl">
                {view === 'email-signin' ? (
                  <>
                    Welcome <span className={GOLD_TEXT}>back</span>
                  </>
                ) : (
                  <>
                    Join <span className={GOLD_TEXT}>VZN.gold</span>
                  </>
                )}
              </DialogTitle>
              <DialogDescription className="text-center text-sm text-muted-foreground">
                {view === 'email-signin'
                  ? 'Enter your email and password to continue.'
                  : 'A few quick details and you’re in.'}
              </DialogDescription>
            </DialogHeader>

            {error && (
              <p className="mt-1 text-center text-sm text-red-500 dark:text-red-400">{error}</p>
            )}

            {view === 'email-signin' ? (
              <form onSubmit={handleSignIn} className="mt-4 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signin-email">Email</Label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-foreground/60" />
                    <Input
                      id="signin-email"
                      type="email"
                      autoFocus
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-10 h-11 rounded-xl border-border/70 bg-background/70 backdrop-blur focus-visible:border-amber-400/60 focus-visible:ring-amber-400/30"
                      disabled={isSubmitting}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="signin-password">Password</Label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute left-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-foreground/60" />
                    <Input
                      id="signin-password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-10 h-11 rounded-xl border-border/70 bg-background/70 backdrop-blur focus-visible:border-amber-400/60 focus-visible:ring-amber-400/30"
                      disabled={isSubmitting}
                    />
                  </div>
                </div>

                <button type="submit" className={PRIMARY_CTA} disabled={isSubmitting}>
                  <span className={PRIMARY_CTA_HOVER_OVERLAY} />
                  <span className="relative flex items-center gap-2 transition-colors group-hover:text-black">
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Signing in…
                      </>
                    ) : (
                      <>
                        Sign in
                        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                      </>
                    )}
                  </span>
                </button>
              </form>
            ) : (
              <form onSubmit={handleSignUp} className="mt-4 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signup-name">Display name</Label>
                  <div className="relative">
                    <User className="pointer-events-none absolute left-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-foreground/60" />
                    <Input
                      id="signup-name"
                      type="text"
                      autoFocus
                      placeholder="Your display name"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="pl-10 h-11 rounded-xl border-border/70 bg-background/70 backdrop-blur focus-visible:border-amber-400/60 focus-visible:ring-amber-400/30"
                      disabled={isSubmitting}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="signup-email">Email</Label>
                  <div className="relative">
                    <Mail className="pointer-events-none absolute left-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-foreground/60" />
                    <Input
                      id="signup-email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="pl-10 h-11 rounded-xl border-border/70 bg-background/70 backdrop-blur focus-visible:border-amber-400/60 focus-visible:ring-amber-400/30"
                      disabled={isSubmitting}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="signup-password">Password</Label>
                    <div className="relative">
                      <Lock className="pointer-events-none absolute left-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-foreground/60" />
                      <Input
                        id="signup-password"
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="pl-10 h-11 rounded-xl border-border/70 bg-background/70 backdrop-blur focus-visible:border-amber-400/60 focus-visible:ring-amber-400/30"
                        disabled={isSubmitting}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="signup-confirm">Confirm</Label>
                    <div className="relative">
                      <Lock className="pointer-events-none absolute left-3.5 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-foreground/60" />
                      <Input
                        id="signup-confirm"
                        type="password"
                        placeholder="••••••••"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="pl-10 h-11 rounded-xl border-border/70 bg-background/70 backdrop-blur focus-visible:border-amber-400/60 focus-visible:ring-amber-400/30"
                        disabled={isSubmitting}
                      />
                    </div>
                  </div>
                </div>

                <button type="submit" className={PRIMARY_CTA} disabled={isSubmitting}>
                  <span className={PRIMARY_CTA_HOVER_OVERLAY} />
                  <span className="relative flex items-center gap-2 transition-colors group-hover:text-black">
                    {isSubmitting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Creating account…
                      </>
                    ) : (
                      <>
                        Create account
                        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                      </>
                    )}
                  </span>
                </button>
              </form>
            )}
          </div>
        ) : (
          <div className={`relative ${VIEW_ANIMATION_BACK}`}>
            <DialogHeader className="relative">
              <div className="mx-auto inline-flex items-center gap-1.5 rounded-full border border-amber-400/40 bg-amber-400/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-amber-600 dark:text-amber-300">
                <Sparkles className="h-3 w-3" />
                Secure sign-in
              </div>
              <DialogTitle className="mt-3 text-center font-vzn-headings text-2xl font-normal tracking-tight sm:text-3xl">
                Welcome to <span className={GOLD_TEXT}>VZN.gold</span>
              </DialogTitle>
              <DialogDescription className="text-center text-sm text-muted-foreground pb-4">
               
              </DialogDescription>
            </DialogHeader>

            {successMessage ? (
              <div className="relative flex flex-col items-center gap-4 pt-2 pb-2">
                <div className="relative">
                  <div
                    aria-hidden
                    className="absolute inset-0 rounded-2xl bg-emerald-400/15 blur-xl"
                  />
                  <div className="relative inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-emerald-400/40 bg-gradient-to-b from-emerald-400/20 to-emerald-400/[0.04] text-emerald-500 dark:text-emerald-300">
                    <CheckCircle2 className="h-7 w-7" />
                  </div>
                </div>
                <p className="max-w-[320px] text-center text-sm text-muted-foreground">
                  {successMessage}
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setSuccessMessage(null);
                    setActiveTab('signin');
                  }}
                  className={`${GHOST_PILL} mt-1`}
                >
                  Back to sign in
                </button>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid w-full grid-cols-2 rounded-full border border-border/60 bg-background/60 p-1 backdrop-blur">
                  {(['signin', 'signup'] as const).map((tab) => {
                    const active = activeTab === tab;
                    return (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => {
                          setActiveTab(tab);
                          setError(null);
                        }}
                        className={`rounded-full px-3 py-1.5 text-xs font-medium uppercase tracking-[0.12em] transition-colors ${
                          active
                            ? 'bg-amber-400/15 text-amber-600 dark:text-amber-300'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {tab === 'signin' ? 'Sign in' : 'Sign up'}
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={handleGoogleSignIn}
                  className={GHOST_PILL}
                  disabled={isGoogleLoading || isSubmitting || isPasskeySubmitting}
                >
                  {isGoogleLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  ) : (
                    <GoogleGlyph className="h-4 w-4 shrink-0" />
                  )}
                  {activeTab === 'signin' ? 'Continue with Google' : 'Sign up with Google'}
                </button>

                {activeTab === 'signin' && passkeysSupported && hasStoredPasskeys && (
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
                        Quick sign-in
                      </span>
                      {storedPasskeysList.length > 1 && (
                        <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                          {storedPasskeysList.length} accounts
                        </span>
                      )}
                    </div>

                    {storedPasskeysList.length >= 1 && (
                      <div className="relative mb-3 space-y-1.5">
                        {storedPasskeysList.map((passkey) => {
                          const isSelected = selectedPasskeyId === passkey.id;
                          return (
                            <div
                              key={passkey.id}
                              onClick={() => {
                                if (confirmDeleteId !== passkey.id) {
                                  setSelectedPasskeyId(passkey.id);
                                }
                              }}
                              className={`group flex cursor-pointer items-center justify-between rounded-xl px-3 py-2 text-xs transition-all
                                ${isSelected
                                  ? 'border border-amber-400/50 bg-amber-400/15 ring-1 ring-amber-400/30'
                                  : 'border border-border/50 bg-background/60 hover:border-border hover:bg-background/80'
                                }`}
                            >
                              {confirmDeleteId === passkey.id ? (
                                <div className="flex items-center justify-between w-full gap-2">
                                  <span className="text-red-500 text-[10px]">Remove this passkey?</span>
                                  <div className="flex gap-1">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        removeAuthPasskey(passkey.id);
                                        const updated = getAuthPasskeys();
                                        setStoredPasskeysList(updated);
                                        setHasStoredPasskeys(updated.length > 0);
                                        setConfirmDeleteId(null);
                                        if (selectedPasskeyId === passkey.id && updated.length > 0) {
                                          setSelectedPasskeyId(updated[0].id);
                                        } else if (updated.length === 0) {
                                          setSelectedPasskeyId(null);
                                        }
                                      }}
                                      className="text-[10px] text-red-500 hover:text-red-600 font-medium px-1.5 py-0.5 rounded bg-red-500/10 hover:bg-red-500/20"
                                    >
                                      Yes
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setConfirmDeleteId(null);
                                      }}
                                      className="text-[10px] text-muted-foreground hover:text-foreground font-medium px-1.5 py-0.5"
                                    >
                                      No
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  <div className="flex items-center gap-2 min-w-0">
                                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isSelected ? 'bg-amber-500' : 'bg-muted-foreground/30'}`} />
                                    <span className={`truncate max-w-[200px] ${isSelected ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                                      {passkey.email}
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setConfirmDeleteId(passkey.id);
                                    }}
                                    className="text-muted-foreground/50 hover:text-red-500 ml-2 p-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                                    title="Remove passkey"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={handlePasskeySignIn}
                      className={PRIMARY_CTA}
                      disabled={isPasskeySubmitting || isSubmitting || !selectedPasskeyId}
                    >
                      <span className={PRIMARY_CTA_HOVER_OVERLAY} />
                      <span className="relative flex items-center gap-2 transition-colors group-hover:text-black">
                        {isPasskeySubmitting ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Signing in…
                          </>
                        ) : (
                          <>
                            <Fingerprint className="h-4 w-4" />
                            Sign in with passkey
                          </>
                        )}
                      </span>
                    </button>

                    <p className="relative mt-3 text-center font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      Stored locally · Device-bound
                    </p>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    setError(null);
                    setView(activeTab === 'signin' ? 'email-signin' : 'email-signup');
                  }}
                  className={GHOST_PILL}
                  disabled={isSubmitting || isPasskeySubmitting || isGoogleLoading}
                >
                  <Mail className="h-4 w-4 shrink-0" />
                  {activeTab === 'signin' ? 'Continue with email' : 'Sign up with email'}
                  <ArrowRight className="h-4 w-4 shrink-0 opacity-60 transition-transform group-hover:translate-x-0.5" />
                </button>

                {error && (
                  <p className="text-center text-sm text-red-500 dark:text-red-400">{error}</p>
                )}

                <p className="pt-1 text-center text-[11px] text-muted-foreground/80">
                  {activeTab === 'signin' ? (
                    <>
                      New here?{' '}
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('signup');
                          setError(null);
                        }}
                        className="font-medium text-amber-600 transition-colors hover:text-amber-500 dark:text-amber-300"
                      >
                        Create an account
                      </button>
                    </>
                  ) : (
                    <>
                      Already have an account?{' '}
                      <button
                        type="button"
                        onClick={() => {
                          setActiveTab('signin');
                          setError(null);
                        }}
                        className="font-medium text-amber-600 transition-colors hover:text-amber-500 dark:text-amber-300"
                      >
                        Sign in
                      </button>
                    </>
                  )}
                </p>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

