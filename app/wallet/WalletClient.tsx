'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useWallet } from '@/app/hooks/use-wallet';
import { useAuth } from '@/app/contexts/AuthContext';

import { Button } from '@/app/components/ui/button';
import { Loader2, Lock, ArrowLeft } from 'lucide-react';
import { Input } from "@/app/components/ui/input";
import { Label } from "@/app/components/ui/label";
import { useToast } from '@/app/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/app/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/app/components/ui/tabs";
import dynamic from 'next/dynamic';
import { Fingerprint } from 'lucide-react';
import {
  isPasskeyAvailable,
  hasWalletPasskey,
  createWalletPasskey,
  hasTempPassword,
  retrieveTempPassword,
  clearTempPassword
} from '@/app/lib/passkeys';
import { useVznContractConfig } from '@/app/hooks/use-vzn-contract-config';
import {
  maxMintFundingSplitCount,
  mintFundingOutputSatoshis,
} from '@/app/lib/mint-funding';

// Import the BackButton as a client component
const BackButton = dynamic(() => import('@/app/components/BackButton'), { 
  loading: () => <div className="w-9 h-9"></div>
});
const CreateEncryptedKeysView = dynamic(
  () => import('@/app/components/wallet/CreateEncryptedKeysView'),
  { loading: () => <div className="py-6" /> }
);
const UnlockEncryptedKeysView = dynamic(
  () => import('@/app/components/wallet/UnlockEncryptedKeysView'),
  { loading: () => <div className="py-6" /> }
);
const WalletTokensTab = dynamic(
  () => import('./tabs/WalletTokensTab'),
  { loading: () => <div className="py-6" /> }
);
const WalletDetailsTab = dynamic(
  () => import('./tabs/WalletDetailsTab'),
  { loading: () => <div className="py-6" /> }
);

export default function WalletPage() {
  // --- Hooks ---
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user: authUser, isLoading: isAuthLoading } = useAuth();
  const { toast } = useToast();

  const {
    isWalletInitialized,
    ownerAddress,
    walletAddress,
    profileOwnerAddress,
    profilePaymentAddress,
    profileOwnerKeyBip38,
    profilePaymentKeyBip38,
    walletBalance,
    confirmedBalance,
    unconfirmedTxs,
    isFetchingProfile,
    isUpdatingProfile,
    fetchProfileAddresses,
    copyToClipboard,
    calculateUSDValue,
    backupWallet,
    fetchDetailedBalance,
    isFetchingBalance,
    sendTransaction,
    prepareMintFundingOutputs,
    isSending,
  } = useWallet();

  // --- State for Send BSV Dialog ---
  const [isSendDialogOpen, setIsSendDialogOpen] = useState(false);
  const [sendAmount, setSendAmount] = useState('');
  const [sendAddress, setSendAddress] = useState('');
  const [sendProgress, setSendProgress] = useState<{
    stage: 'idle' | 'calculating' | 'building' | 'broadcasting' | 'completed';
    selectedUtxos: Array<{ txid: string; vout: number; satoshis: number; script?: string }>;
    txid?: string;
    error?: string;
  }>({
    stage: 'idle',
    selectedUtxos: [],
  });

  // --- State for Prepare Mint UTXOs Dialog ---
  const [isPrepareMintDialogOpen, setIsPrepareMintDialogOpen] = useState(false);
  const [mintSplitCount, setMintSplitCount] = useState('1');
  const [prepareMintProgress, setPrepareMintProgress] = useState<{
    stage: 'idle' | 'building' | 'broadcasting' | 'completed';
    txid?: string;
  }>({ stage: 'idle' });
  const {
    contractSats,
    isLoading: isContractConfigLoading,
    isError: isContractConfigError,
  } = useVznContractConfig(isPrepareMintDialogOpen);

  const mintOutputSatoshis =
    typeof contractSats === 'number' && contractSats > 0
      ? mintFundingOutputSatoshis(contractSats)
      : null;
  const maxMintSplits =
    mintOutputSatoshis !== null
      ? maxMintFundingSplitCount(walletBalance, mintOutputSatoshis)
      : 0;
  const requestedMintSplits = (() => {
    const parsed = parseInt(mintSplitCount.replace(/,/g, ''), 10);
    return Number.isFinite(parsed) ? parsed : 0;
  })();

  // --- State for Wallet View Tabs ---
  const [activeWalletView, setActiveWalletView] = useState<'tokens' | 'details'>('details');

  // --- State for VZN token balance ---
  const [vznBalance, setVznBalance] = useState<number>(0);
  const [isFetchingVznBalance, setIsFetchingVznBalance] = useState(false);

  // --- State for Wallet Passkey Save Prompt ---
  const [showWalletPasskeyPrompt, setShowWalletPasskeyPrompt] = useState(false);
  const [isSavingWalletPasskey, setIsSavingWalletPasskey] = useState(false);
  const [walletPasskeyChecked, setWalletPasskeyChecked] = useState(false);

  // --- Function to fetch VZN balance ---
  const fetchVznBalance = useCallback(async () => {
    if (!ownerAddress) return;
    
    setIsFetchingVznBalance(true);
    try {
      const response = await fetch(
        `/api/overlay/bsv21/balance?address=${encodeURIComponent(ownerAddress)}`,
        { cache: 'no-store' }
      );
      if (!response.ok) {
        throw new Error('Failed to fetch VZN balance');
      }
      
      const data = await response.json();
      setVznBalance(data.balance || 0);
      console.log('VZN balance updated (overlay):', data.balance, '(utxos:', data.utxoCount, ')');
    } catch (error) {
      console.error('Error fetching VZN balance:', error);
      toast({
        variant: 'destructive',
        description: 'Failed to load VZN balance',
        duration: 2000,
      });
      setVznBalance(0);
    } finally {
      setIsFetchingVznBalance(false);
    }
  }, [ownerAddress, toast]);

  // --- Effects ---

  useEffect(() => {
    if (authUser && !profileOwnerAddress && !profilePaymentAddress) {
      console.log('WalletPage: Auth user detected, fetching profile addresses...');
      fetchProfileAddresses();
    }
  }, [authUser, profileOwnerAddress, profilePaymentAddress, fetchProfileAddresses]);

  useEffect(() => {
    if (!isAuthLoading && !authUser) {
      router.replace('/login');
    }
  }, [authUser, isAuthLoading, router]);

  // Encryption dialog moved to component

  useEffect(() => {
    const viewParam = searchParams.get('view');
    if (viewParam === 'tokens' && profileOwnerAddress && profilePaymentAddress) {
      setActiveWalletView('tokens');
    } else if (profileOwnerAddress && profilePaymentAddress) {
      setActiveWalletView('details');
      if (viewParam !== 'details') {
        router.replace('/wallet?view=details');
      }
    }
  }, [searchParams, router, profileOwnerAddress, profilePaymentAddress]);



  // Check if we should show wallet passkey save prompt after unlock
  useEffect(() => {
    // Only check once when wallet becomes initialized
    if (isWalletInitialized && profileOwnerAddress && !walletPasskeyChecked) {
      setWalletPasskeyChecked(true);
      
      // Check if:
      // 1. There's a stored password (confirms this is a fresh unlock, not page reload)
      // 2. Passkeys are supported
      // 3. No passkey exists for this wallet
      const hasStoredPassword = hasTempPassword();
      
      if (hasStoredPassword && isPasskeyAvailable() && !hasWalletPasskey(profileOwnerAddress)) {
        // Small delay to let the page settle after unlock
        setTimeout(() => {
          setShowWalletPasskeyPrompt(true);
        }, 500);
      } else if (hasStoredPassword) {
        // Clean up stored password if we're not showing the prompt
        clearTempPassword();
      }
    }
  }, [isWalletInitialized, profileOwnerAddress, walletPasskeyChecked]);

  // Reset passkey checked state when wallet is locked
  useEffect(() => {
    if (!isWalletInitialized) {
      setWalletPasskeyChecked(false);
    }
  }, [isWalletInitialized]);

  useEffect(() => {
    return () => {
      clearTempPassword();
    };
  }, []);

  // Fetch VZN balance when owner address changes or tokens view is active
  useEffect(() => {
    if (ownerAddress && (activeWalletView === 'tokens' || activeWalletView === 'details')) {
      fetchVznBalance();
    }
  }, [ownerAddress, activeWalletView, fetchVznBalance]);

  // Handler for saving wallet passkey
  const handleSaveWalletPasskey = async () => {
    if (!profileOwnerAddress) return;
    const walletPasskeyName = `wallet-${profileOwnerAddress.slice(0, 8)}`;
    
    // Get securely stored temporary password
    const password = await retrieveTempPassword();
    if (!password) {
      toast({
        variant: 'destructive',
        description: 'Session expired. Please unlock again to save passkey.',
        duration: 3000,
      });
      setShowWalletPasskeyPrompt(false);
      return;
    }
    
    setIsSavingWalletPasskey(true);
    try {
      await createWalletPasskey({
        ownerAddress: profileOwnerAddress,
        password: password,
        name: walletPasskeyName
      });
      toast({
        description: 'Passkey saved!',
        duration: 3000,
      });
      setShowWalletPasskeyPrompt(false);
      router.push('/');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save passkey';
      if (!message.toLowerCase().includes('cancel') && !message.toLowerCase().includes('abort')) {
        toast({
          variant: 'destructive',
          description: message,
          duration: 3000,
        });
      }
    } finally {
      setIsSavingWalletPasskey(false);
      // Always clear the temporary password
      clearTempPassword();
    }
  };

  // Redirect to the index page after the wallet is unlocked. If a passkey-save
  // prompt is about to be shown, defer the redirect until it is resolved.
  const handleWalletUnlocked = useCallback(() => {
    const willPromptPasskey =
      hasTempPassword() &&
      isPasskeyAvailable() &&
      Boolean(profileOwnerAddress) &&
      !hasWalletPasskey(profileOwnerAddress as string);

    if (!willPromptPasskey) {
      router.push('/');
    }
  }, [profileOwnerAddress, router]);

  // Handler for skipping passkey save
  const handleSkipWalletPasskey = () => {
    clearTempPassword();
    setShowWalletPasskeyPrompt(false);
    router.push('/');
  };

  const handlePrepareMintUtxos = async () => {
    if (mintOutputSatoshis === null) {
      toast({
        variant: 'destructive',
        description: 'Could not load contract lock amount',
        duration: 2000,
      });
      return;
    }
    if (!Number.isInteger(requestedMintSplits) || requestedMintSplits < 1) {
      toast({
        variant: 'destructive',
        description: 'Enter how many LLM UTXOs to create',
        duration: 2000,
      });
      return;
    }
    if (requestedMintSplits > maxMintSplits) {
      toast({
        variant: 'destructive',
        description: `Balance only covers ${maxMintSplits} LLM UTXO${maxMintSplits === 1 ? '' : 's'}`,
        duration: 2500,
      });
      return;
    }

    try {
      setPrepareMintProgress({ stage: 'building' });
      await new Promise((resolve) => setTimeout(resolve, 250));
      setPrepareMintProgress({ stage: 'broadcasting' });

      const txid = await prepareMintFundingOutputs(mintOutputSatoshis, requestedMintSplits);
      if (!txid) {
        setPrepareMintProgress({ stage: 'idle' });
        return;
      }

      setPrepareMintProgress({ stage: 'completed', txid });
      await new Promise((resolve) => setTimeout(resolve, 1200));
      setIsPrepareMintDialogOpen(false);
      setMintSplitCount('1');
      setPrepareMintProgress({ stage: 'idle' });
    } catch (error) {
      console.error('Error preparing LLM funding UTXOs:', error);
      setPrepareMintProgress({ stage: 'idle' });
      toast({
        variant: 'destructive',
        title: 'Prepare failed',
        description: `Could not prepare LLM UTXOs: ${(error as Error).message}`,
        duration: 3000,
      });
    }
  };

  const handleSendBSV = async () => {
    // Reset progress
    setSendProgress({ stage: 'idle', selectedUtxos: [] });

    // Validate inputs
    if (!sendAddress.trim()) {
      toast({ variant: 'destructive', description: 'Please enter a valid address', duration: 2000 });
      return;
    }

    const amountInSats = parseInt(sendAmount.replace(/,/g, ''));
    if (isNaN(amountInSats) || amountInSats <= 0) {
      toast({ variant: 'destructive', description: 'Please enter a valid amount in sats', duration: 2000 });
      return;
    }

    if (amountInSats > walletBalance) {
      toast({ variant: 'destructive', description: 'Amount exceeds wallet balance', duration: 2000 });
      return;
    }

    try {
      console.log('Sending BSV:', { amount: amountInSats, address: sendAddress });
      
      // Stage 1: Calculating optimal UTXOs
      setSendProgress({ stage: 'calculating', selectedUtxos: [] });
      
      // Fetch real UTXOs for progress display
      let selectedUtxos: Array<{ txid: string; vout: number; satoshis: number }> = [];
      try {
        const { getPaymentUTXOs } = await import('@/app/lib/wallet-payment');
        const utxos = await getPaymentUTXOs(walletAddress, amountInSats + 1000); // Add buffer for fees
        selectedUtxos = utxos.map(u => ({
          txid: u.txId,
          vout: u.outputIndex,
          satoshis: u.satoshis
        }));
        console.log('Selected UTXOs for send:', selectedUtxos);
      } catch (err) {
        console.warn('Could not fetch UTXOs for display:', err);
      }

      // Stage 2: Building transaction
      setSendProgress({ 
        stage: 'building', 
        selectedUtxos: selectedUtxos.slice(0, 3) // Show max 3 for UI elegance
      });
      
      await new Promise(resolve => setTimeout(resolve, 500)); // Small delay for UX

      // Stage 3: Broadcasting
      setSendProgress(prev => ({ ...prev, stage: 'broadcasting' }));
      
      const txid = await sendTransaction(amountInSats, sendAddress);
      
      if (txid) {
        console.log('BSV sent successfully:', txid);
        
        // Stage 4: Completed
        setSendProgress(prev => ({ ...prev, stage: 'completed', txid }));
        
        // Show success for a moment before closing
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        toast({ 
          description: `BSV sent successfully! TXID: ${txid.substring(0, 12)}...`, 
          duration: 4000 
        });
        
        // Close dialog and reset form
        setIsSendDialogOpen(false);
        setSendAmount('');
        setSendAddress('');
        setSendProgress({ stage: 'idle', selectedUtxos: [] });
        
        // Balance refresh is triggered by the wallet hook after successful send
      }
      
    } catch (error) {
      console.error('Error sending BSV:', error);
      setSendProgress(prev => ({ 
        ...prev, 
        stage: 'idle', 
        error: (error as Error).message 
      }));
      toast({
        variant: 'destructive',
        title: 'Send Failed',
        description: `Could not send BSV: ${(error as Error).message}`,
        duration: 3000
      });
    }
  };

  // --- Render Logic ---

  if (isAuthLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500 dark:text-amber-400 mb-4" />
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Checking authentication…</p>
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500 dark:text-amber-400 mb-4" />
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Redirecting to login…</p>
      </div>
    );
  }

  if (isFetchingProfile) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-4">
        <Loader2 className="h-8 w-8 animate-spin text-amber-500 dark:text-amber-400 mb-4" />
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Loading wallet details…</p>
      </div>
    );
  }

  // Show encrypted-keys setup/unlock regardless of whether profile addresses are set
  if (!isWalletInitialized && (!profileOwnerKeyBip38 || !profilePaymentKeyBip38)) {
    return (
      <CreateEncryptedKeysView
        onSaved={() => {
          // Refresh profile so the new encrypted keys are detected
          fetchProfileAddresses();
        }}
      />
    );
  }

  if (!isWalletInitialized && (profileOwnerKeyBip38 && profilePaymentKeyBip38)) {
    return <UnlockEncryptedKeysView onUnlocked={handleWalletUnlocked} />;
  }

  if (profileOwnerAddress && profilePaymentAddress) {
    const localWalletMatchesProfile =
      isWalletInitialized &&
      ownerAddress === profileOwnerAddress &&
      walletAddress === profilePaymentAddress;

    const localWalletActiveButMismatched =
      isWalletInitialized &&
      !localWalletMatchesProfile;

    // --- Debugging Logs --- 
    console.log('WalletPage State (Profile Linked):',
      {
        isWalletInitialized,
        ownerAddress,
        walletAddress,
        profileOwnerAddress,
        profilePaymentAddress,
        localWalletMatchesProfile,
        localWalletActiveButMismatched,
      }
    );
    // --- End Debugging Logs ---

    // If no local wallet is initialized and profile is missing either encrypted key, guide user to create them
    if (!isWalletInitialized && (!profileOwnerKeyBip38 || !profilePaymentKeyBip38)) {
      return (
        <CreateEncryptedKeysView
          onSaved={() => {
            // Refresh profile so the new encrypted keys are detected
            fetchProfileAddresses();
          }}
        />
      )
    }

    // If no local wallet is initialized but profile has both encrypted keys, show unlock view
    if (!isWalletInitialized && (profileOwnerKeyBip38 && profilePaymentKeyBip38)) {
      return (
        <UnlockEncryptedKeysView onUnlocked={handleWalletUnlocked} />
      )
    }

    return (
      <div className="flex flex-col items-center min-h-screen md:justify-start">
        {/* Only show tabs when there's a local wallet initialized AND no wallet mismatch */}
        {isWalletInitialized && !localWalletActiveButMismatched && (
          <div className="w-full max-w-2xl lg:mt-8 mt-8 mx-auto px-4 pb-24 lg:pb-8">
            {/* Header with Back Button and Vault Button */}
            <div className="flex items-center gap-3 mb-6">
              <BackButton>
                <ArrowLeft className="h-5 w-5" />
              </BackButton>
              <div className="flex-1 flex justify-between items-center">
                <h1 className="font-vzn-headings text-2xl font-normal tracking-tight">Wallet</h1>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.push('/vault')}
                  className="flex items-center gap-2 rounded-full border-border/70 bg-background/60 text-muted-foreground hover:border-amber-400/60 hover:bg-amber-400/10 hover:text-amber-600 dark:hover:text-amber-300 transition-colors backdrop-blur"
                >
                  <Lock className="h-4 w-4" />
                  <span className="font-sans">Vault</span>
                </Button>
              </div>
            </div>
            
            <Tabs value={activeWalletView} onValueChange={(value) => {
              const view = value as 'tokens' | 'details';
              setActiveWalletView(view);
              if (view === 'tokens') {
                router.push('/wallet?view=tokens');
              } else {
                router.push('/wallet?view=details');
              }
            }} className="w-full">
              <TabsList className="grid w-full grid-cols-2 rounded-full border border-border/60 bg-background/60 p-1 backdrop-blur mb-2">
                <TabsTrigger
                  value="details"
                  className="rounded-full text-sm data-[state=active]:bg-amber-400/15 data-[state=active]:text-amber-600 dark:data-[state=active]:text-amber-300 data-[state=active]:shadow-none"
                >
                  Wallet
                </TabsTrigger>
                <TabsTrigger
                  value="tokens"
                  className="rounded-full text-sm data-[state=active]:bg-amber-400/15 data-[state=active]:text-amber-600 dark:data-[state=active]:text-amber-300 data-[state=active]:shadow-none"
                >
                  Tokens
                </TabsTrigger>
                {/* NFTs tab hidden to focus on VZN */}
              </TabsList>

              {activeWalletView === 'tokens' && (
                <WalletTokensTab
                  isFetchingVznBalance={isFetchingVznBalance}
                  fetchVznBalance={fetchVznBalance}
                  vznBalance={vznBalance}
                  onTradeClick={() => router.push('/trade')}
                />
              )}


              {activeWalletView === 'details' && (
                <WalletDetailsTab
                  copyToClipboard={copyToClipboard}
                  profileOwnerAddress={profileOwnerAddress}
                  profilePaymentAddress={profilePaymentAddress}
                  isFetchingBalance={isFetchingBalance}
                  fetchDetailedBalance={fetchDetailedBalance}
                  walletBalance={walletBalance}
                  calculateUSDValue={calculateUSDValue}
                  confirmedBalance={confirmedBalance}
                  unconfirmedTxs={unconfirmedTxs}
                  isUpdatingProfile={isUpdatingProfile}
                  isSending={isSending}
                  setIsSendDialogOpen={setIsSendDialogOpen}
                  setIsPrepareMintDialogOpen={setIsPrepareMintDialogOpen}
                  backupWallet={backupWallet}
                />
              )}

            </Tabs>
          </div>
        )}

        {/* Prepare mint UTXOs dialog */}
        <Dialog
          open={isPrepareMintDialogOpen}
          onOpenChange={(open) => {
            if (prepareMintProgress.stage !== 'idle' && prepareMintProgress.stage !== 'completed') {
              return;
            }
            setIsPrepareMintDialogOpen(open);
            if (!open) {
              setPrepareMintProgress({ stage: 'idle' });
            }
          }}
        >
          <DialogContent className="max-w-[420px] rounded-2xl z-[200] border border-border/60 bg-background/95 p-0 backdrop-blur-xl shadow-[0_0_0_1px_rgba(245,158,11,0.2),0_20px_50px_-20px_rgba(0,0,0,0.55)]">
            <div className="p-6">
              <DialogHeader className="pb-4">
                <DialogTitle className="font-vzn-headings text-2xl font-normal tracking-tight">
                  Prepare <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#FBBF24] via-[#F59E0B] to-[#FBBF24]">LLM</span> UTXOs
                </DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">
                  Split your balance into funding UTXOs for LockLikeMints
                  {mintOutputSatoshis !== null
                    ? ` — ${mintOutputSatoshis.toLocaleString()} sats each.`
                    : isContractConfigLoading
                      ? '…'
                      : '.'}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-5">
                {isContractConfigError && (
                  <p className="text-sm text-destructive">
                    Failed to load contract settings. Close and try again.
                  </p>
                )}

                <div className="space-y-2">
                  <Label
                    htmlFor="mintSplitCount"
                    className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground"
                  >
                    How many
                  </Label>
                  <Input
                    id="mintSplitCount"
                    inputMode="numeric"
                    placeholder="e.g. 5"
                    value={mintSplitCount}
                    onChange={(e) => {
                      const rawValue = e.target.value.replace(/[^\d]/g, '');
                      setMintSplitCount(rawValue ? parseInt(rawValue, 10).toLocaleString() : '');
                    }}
                    type="text"
                    className="h-11 rounded-xl border-border/70 bg-background/70 text-base sm:text-sm backdrop-blur focus-visible:border-amber-400/60 focus-visible:ring-amber-400/30"
                    disabled={prepareMintProgress.stage !== 'idle' || isContractConfigLoading}
                  />
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        if (maxMintSplits > 0) {
                          setMintSplitCount(String(maxMintSplits));
                        }
                      }}
                      disabled={
                        prepareMintProgress.stage !== 'idle' ||
                        maxMintSplits <= 0
                      }
                      className="text-xs text-muted-foreground hover:text-amber-600 dark:hover:text-amber-300 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:hover:text-muted-foreground"
                    >
                      Use max ({maxMintSplits || '…'})
                    </button>
                  </div>
                </div>

                {prepareMintProgress.stage !== 'idle' && (
                  <div className="rounded-2xl border border-border/60 bg-background/60 p-4 backdrop-blur space-y-2">
                    {[
                      { stage: 'building', label: 'Building transaction' },
                      { stage: 'broadcasting', label: 'Broadcasting' },
                      { stage: 'completed', label: 'Done' },
                    ].map((step) => {
                      const order = ['building', 'broadcasting', 'completed'] as const;
                      const currentIndex = order.indexOf(prepareMintProgress.stage as typeof order[number]);
                      const stepIndex = order.indexOf(step.stage as typeof order[number]);
                      const isActive = prepareMintProgress.stage === step.stage;
                      const isDone = currentIndex > stepIndex;
                      return (
                        <div
                          key={step.stage}
                          className={`flex items-center gap-3 p-2 rounded-lg ${
                            isActive
                              ? 'bg-amber-400/10 text-amber-700 dark:text-amber-300'
                              : isDone
                                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                : 'text-muted-foreground'
                          }`}
                        >
                          <span className="text-sm font-medium">{step.label}</span>
                          {isActive && prepareMintProgress.stage !== 'completed' && (
                            <Loader2 className="w-3 h-3 animate-spin ml-auto" />
                          )}
                        </div>
                      );
                    })}
                    {prepareMintProgress.stage === 'completed' && prepareMintProgress.txid && (
                      <p className="text-xs font-mono text-emerald-600 dark:text-emerald-400 pt-1">
                        TXID: {prepareMintProgress.txid.substring(0, 12)}...
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-border/60 bg-background/60 backdrop-blur rounded-b-2xl">
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsPrepareMintDialogOpen(false);
                    setPrepareMintProgress({ stage: 'idle' });
                  }}
                  disabled={
                    prepareMintProgress.stage !== 'idle' &&
                    prepareMintProgress.stage !== 'completed'
                  }
                  className="flex-1 rounded-full border border-border/70 bg-background/60 px-6 py-3 text-sm font-medium text-foreground backdrop-blur transition-colors hover:bg-muted/60 disabled:pointer-events-none disabled:opacity-60"
                >
                  {prepareMintProgress.stage === 'completed' ? 'Close' : 'Cancel'}
                </button>
                {prepareMintProgress.stage !== 'completed' && (
                  <button
                    type="button"
                    onClick={handlePrepareMintUtxos}
                    disabled={
                      prepareMintProgress.stage !== 'idle' ||
                      isSending ||
                      isContractConfigLoading ||
                      mintOutputSatoshis === null ||
                      !Number.isInteger(requestedMintSplits) ||
                      requestedMintSplits < 1 ||
                      requestedMintSplits > maxMintSplits
                    }
                    className="group relative flex-1 inline-flex items-center justify-center gap-2 overflow-hidden rounded-full bg-gradient-to-r from-amber-400 via-amber-500 to-amber-400 px-6 py-3 text-sm font-semibold text-black shadow-[0_10px_30px_-10px_rgba(245,158,11,0.55)] transition-all hover:scale-[1.01] hover:shadow-[0_14px_40px_-10px_rgba(245,158,11,0.75)] disabled:pointer-events-none disabled:opacity-60"
                  >
                    <span className="relative flex items-center justify-center gap-2">
                      {prepareMintProgress.stage === 'idle' ? (
                        'Create UTXOs'
                      ) : (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>Processing…</span>
                        </>
                      )}
                    </span>
                  </button>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Send BSV Dialog - Available for both tabs */}
        <Dialog open={isSendDialogOpen} onOpenChange={setIsSendDialogOpen}>
          <DialogContent className="max-w-[420px] rounded-2xl z-[200] border border-border/60 bg-background/95 p-0 backdrop-blur-xl shadow-[0_0_0_1px_rgba(245,158,11,0.2),0_20px_50px_-20px_rgba(0,0,0,0.55)]">
            <div className="p-6">
              <DialogHeader className="pb-4">
                <DialogTitle className="font-vzn-headings text-2xl font-normal tracking-tight">
                  Send <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#FBBF24] via-[#F59E0B] to-[#FBBF24]">sats</span>
                </DialogTitle>
                <DialogDescription className="text-sm text-muted-foreground">
                  Send BSV to any address securely
                </DialogDescription>
              </DialogHeader>
              
              <div className="space-y-5">
                {/* Form Fields */}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="sendAddress" className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      Recipient address
                    </Label>
                    <Input
                      id="sendAddress"
                      placeholder="Enter BSV address"
                      value={sendAddress}
                      onChange={(e) => setSendAddress(e.target.value)}
                      type="text"
                      className="h-11 rounded-xl border-border/70 bg-background/70 font-mono text-base sm:text-sm backdrop-blur focus-visible:border-amber-400/60 focus-visible:ring-amber-400/30"
                      disabled={sendProgress.stage !== 'idle'}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="sendAmount" className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      Amount (in sats)
                    </Label>
                    <Input
                      id="sendAmount"
                      placeholder="Enter amount in satoshis"
                      value={sendAmount}
                      onChange={(e) => {
                        const rawValue = e.target.value.replace(/[^\d]/g, '');
                        const formattedValue = rawValue ? parseInt(rawValue).toLocaleString() : '';
                        setSendAmount(formattedValue);
                      }}
                      type="text"
                      className="h-11 rounded-xl border-border/70 bg-background/70 text-base sm:text-sm backdrop-blur focus-visible:border-amber-400/60 focus-visible:ring-amber-400/30"
                      disabled={sendProgress.stage !== 'idle'}
                    />
                    
                    {/* Amount Info */}
                    <div className="flex justify-between items-center text-xs">
                      {sendAmount && !isNaN(parseInt(sendAmount.replace(/,/g, ''))) && parseInt(sendAmount.replace(/,/g, '')) > 0 && (
                        <span className="text-muted-foreground font-medium">
                          ≈ ${calculateUSDValue(parseInt(sendAmount.replace(/,/g, '')))} USD
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          if (walletBalance > 1000) {
                            const maxSendAmount = walletBalance - 1000;
                            setSendAmount(maxSendAmount.toLocaleString());
                          }
                        }}
                        disabled={sendProgress.stage !== 'idle' || walletBalance <= 1000}
                        className="text-muted-foreground hover:text-amber-600 dark:hover:text-amber-300 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:hover:text-muted-foreground"
                        title="Click to send maximum available (balance - 1000 sats mining fee)"
                      >
                        Available: {walletBalance.toLocaleString()} sats
                      </button>
                    </div>
                  </div>
                </div>

                {/* Progress Section */}
                {sendProgress.stage !== 'idle' && (
                  <div className="rounded-2xl border border-border/60 bg-background/60 p-4 backdrop-blur">
                    <div className="space-y-3">
                      {/* Progress Header */}
                      <div className="flex items-center justify-between">
                        <h3 className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                          Transaction progress
                        </h3>
                        <div className="flex items-center gap-2">
                          {sendProgress.stage === 'completed' ? (
                            <div className="w-5 h-5 bg-emerald-500 rounded-full flex items-center justify-center">
                              <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                              </svg>
                            </div>
                          ) : (
                            <div className="w-5 h-5">
                              <Loader2 className="w-5 h-5 animate-spin text-amber-500" />
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Progress Steps */}
                      <div className="space-y-2">
                        {[
                          { stage: 'calculating', label: 'Selecting optimal UTXOs', icon: '🔍' },
                          { stage: 'building', label: 'Building transaction', icon: '🔧' },
                          { stage: 'broadcasting', label: 'Broadcasting to network', icon: '📡' },
                          { stage: 'completed', label: 'Transaction completed', icon: '✅' }
                        ].map((step, index) => (
                          <div 
                            key={step.stage}
                            className={`flex items-center gap-3 p-2 rounded-lg transition-all ${
                              sendProgress.stage === step.stage 
                                ? 'bg-amber-400/10 text-amber-700 dark:text-amber-300' 
                                : index < ['calculating', 'building', 'broadcasting', 'completed'].indexOf(sendProgress.stage)
                                ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                : 'text-muted-foreground'
                            }`}
                          >
                            <span className="text-sm">{step.icon}</span>
                            <span className="text-sm font-medium">{step.label}</span>
                            {sendProgress.stage === step.stage && (
                              <Loader2 className="w-3 h-3 animate-spin ml-auto" />
                            )}
                          </div>
                        ))}
                      </div>

                      {/* UTXO Details */}
                      {sendProgress.selectedUtxos.length > 0 && sendProgress.stage !== 'completed' && (
                        <div className="mt-4 space-y-2">
                          <h4 className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                            Selected UTXOs
                          </h4>
                          <div className="space-y-1">
                            {sendProgress.selectedUtxos.map((utxo, index) => (
                              <div 
                                key={`${utxo.txid}-${utxo.vout}`}
                                className="flex items-center justify-between p-2 rounded-lg border border-border/60 bg-background/70 backdrop-blur"
                              >
                                <div className="flex items-center gap-2">
                                  <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse"></div>
                                  <span className="text-xs font-mono text-muted-foreground">
                                    {utxo.txid.substring(0, 8)}...:{utxo.vout}
                                  </span>
                                </div>
                                <span className="text-xs font-semibold text-foreground font-mono tabular-nums">
                                  {utxo.satoshis.toLocaleString()} sats
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Success Message */}
                      {sendProgress.stage === 'completed' && sendProgress.txid && (
                        <div className="mt-4 p-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10">
                          <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                            Transaction successful! 🎉
                          </p>
                          <p className="text-xs text-emerald-600/90 dark:text-emerald-400 mt-1 font-mono">
                            TXID: {sendProgress.txid.substring(0, 12)}...
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-border/60 bg-background/60 backdrop-blur rounded-b-2xl">
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setIsSendDialogOpen(false);
                    setSendProgress({ stage: 'idle', selectedUtxos: [] });
                  }}
                  disabled={sendProgress.stage !== 'idle' && sendProgress.stage !== 'completed'}
                  className="flex-1 rounded-full border border-border/70 bg-background/60 px-6 py-3 text-sm font-medium text-foreground backdrop-blur transition-colors hover:bg-muted/60 disabled:pointer-events-none disabled:opacity-60"
                >
                  {sendProgress.stage === 'completed' ? 'Close' : 'Cancel'}
                </button>

                {sendProgress.stage !== 'completed' && (
                  <button
                    type="button"
                    onClick={handleSendBSV}
                    disabled={
                      sendProgress.stage !== 'idle' ||
                      !sendAddress.trim() ||
                      !sendAmount ||
                      isNaN(parseInt(sendAmount.replace(/,/g, ''))) ||
                      parseInt(sendAmount.replace(/,/g, '')) <= 0 ||
                      parseInt(sendAmount.replace(/,/g, '')) > walletBalance
                    }
                    className="group relative flex-1 inline-flex items-center justify-center gap-2 overflow-hidden rounded-full bg-gradient-to-r from-amber-400 via-amber-500 to-amber-400 px-6 py-3 text-sm font-semibold text-black shadow-[0_10px_30px_-10px_rgba(245,158,11,0.55)] transition-all hover:scale-[1.01] hover:shadow-[0_14px_40px_-10px_rgba(245,158,11,0.75)] disabled:pointer-events-none disabled:opacity-60"
                  >
                    <span className="absolute inset-0 bg-gradient-to-r from-amber-300 via-amber-200 to-amber-300 opacity-0 transition-opacity group-hover:opacity-100" />
                    <span className="relative flex items-center justify-center gap-2">
                      {sendProgress.stage === 'idle' ? (
                        'Send Sats'
                      ) : (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span>Processing...</span>
                        </>
                      )}
                    </span>
                  </button>
                )}
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Wallet Passkey Save Prompt Dialog */}
        <Dialog open={showWalletPasskeyPrompt} onOpenChange={(open) => {
          if (!open) handleSkipWalletPasskey();
        }}>
          <DialogContent className="max-w-[400px] rounded-2xl z-[200] border border-border/60 bg-background/95 backdrop-blur-xl shadow-[0_0_0_1px_rgba(245,158,11,0.2),0_20px_50px_-20px_rgba(0,0,0,0.55)]">
            <DialogHeader className="text-center pb-2">
              <DialogTitle className="font-vzn-headings text-2xl font-normal tracking-tight">
                Quick <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#FBBF24] via-[#F59E0B] to-[#FBBF24]">unlock</span>
              </DialogTitle>
              <DialogDescription className="text-center text-sm text-muted-foreground">
                Save a passkey to unlock your wallet faster next time
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col items-center gap-4 py-4">
              <div className="relative rounded-2xl bg-gradient-to-br from-amber-400/20 via-amber-400/10 to-transparent p-4 ring-1 ring-amber-400/30 shadow-[0_10px_30px_-10px_rgba(245,158,11,0.35)]">
                <Fingerprint className="h-10 w-10 text-amber-500 dark:text-amber-400" />
              </div>

              <p className="text-sm text-muted-foreground text-center max-w-[280px]">
                Use Face ID, Touch ID, or your device PIN to unlock instantly without typing your password.
              </p>

              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70 text-center">
                Stored locally on your device only
              </p>
            </div>

            <DialogFooter className="flex flex-col gap-2 sm:flex-col">
              <button
                type="button"
                onClick={handleSaveWalletPasskey}
                className="group relative inline-flex w-full items-center justify-center gap-2 overflow-hidden rounded-full bg-gradient-to-r from-amber-400 via-amber-500 to-amber-400 px-6 py-3 text-sm font-semibold text-black shadow-[0_10px_30px_-10px_rgba(245,158,11,0.55)] transition-all hover:scale-[1.01] hover:shadow-[0_14px_40px_-10px_rgba(245,158,11,0.75)] disabled:pointer-events-none disabled:opacity-60"
                disabled={isSavingWalletPasskey}
              >
                <span className="absolute inset-0 bg-gradient-to-r from-amber-300 via-amber-200 to-amber-300 opacity-0 transition-opacity group-hover:opacity-100" />
                <span className="relative flex items-center justify-center gap-2">
                  {isSavingWalletPasskey ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Setting up...
                    </>
                  ) : (
                    <>
                      <Fingerprint className="h-4 w-4" />
                      Save Passkey
                    </>
                  )}
                </span>
              </button>
              <button
                type="button"
                onClick={handleSkipWalletPasskey}
                className="inline-flex w-full items-center justify-center rounded-full border border-border/70 bg-background/60 px-4 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted/60 disabled:pointer-events-none disabled:opacity-60"
                disabled={isSavingWalletPasskey}
              >
                Skip for now
              </button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

      </div>
    );
  }
} 