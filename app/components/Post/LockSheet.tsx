import React, { useState, useCallback, useEffect } from 'react';
import { Check, Lock, Loader2, LogIn } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/app/components/ui/sheet";
import { ThinkingOrb } from "thinking-orbs";
import { useToast } from "@/app/hooks/use-toast";
import { useAuth } from "@/app/contexts/AuthContext";
import { formatUSD, formatBlocksToTime } from '@/app/lib/utils';
import { useWallet } from "@/app/hooks/use-wallet";
import { useNetworkStats } from '@/app/hooks/use-network-stats';
import { useVznContractConfig } from '@/app/hooks/use-vzn-contract-config';
import { formatTokenTicker } from '@/app/lib/formatTokenTicker';
import { formatProgressElapsedTime, getTransactionProgressLabel } from '@/app/lib/transaction-progress';

type LockSheetProps = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  bsvPrice: number | null;
  isPriceError: boolean;
  isLocking: boolean;
  progress: number;
  onConfirmLock: (sats: number, blocks: number) => Promise<string | null>;
  onRequestLogin?: () => void;
};

type LockView = 'form' | 'processing' | 'success';

const GOLD_TEXT =
  'text-transparent bg-clip-text bg-gradient-to-r from-[#FBBF24] via-[#F59E0B] to-[#FBBF24]';

const PRIMARY_CTA =
  'group relative inline-flex items-center justify-center gap-2 overflow-hidden rounded-full border border-amber-400/60 bg-background/40 px-6 py-3 text-sm font-semibold text-amber-600 dark:text-amber-300 shadow-[0_10px_30px_-18px_rgba(245,158,11,0.35)] backdrop-blur transition-all hover:scale-[1.01] hover:border-amber-400 hover:bg-amber-400/10 hover:shadow-[0_14px_40px_-14px_rgba(245,158,11,0.45)] disabled:pointer-events-none disabled:opacity-60';

const PRIMARY_CTA_HOVER_OVERLAY =
  'absolute inset-0 bg-gradient-to-r from-amber-400/0 via-amber-400/10 to-amber-400/0 opacity-0 transition-opacity group-hover:opacity-100';

const GHOST_PILL =
  'inline-flex items-center justify-center gap-2 rounded-full border border-border/70 bg-background/60 px-5 py-3 text-sm font-medium text-foreground backdrop-blur transition-colors hover:border-foreground/30 hover:bg-background disabled:pointer-events-none disabled:opacity-60';

function ContractValueSpinner({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span className="text-sm">{label}</span>
    </span>
  );
}

/**
 * A sheet component for users to input and confirm locking satoshis to a post.
 */
export const LockSheet = ({
  isOpen,
  onOpenChange,
  bsvPrice,
  isPriceError,
  isLocking,
  progress,
  onConfirmLock,
  onRequestLogin,
}: LockSheetProps) => {
  const {
    contractSats,
    contractBlocks,
    isLoading: isContractConfigLoading,
    isError: isContractConfigError,
  } = useVznContractConfig(isOpen);
  const { data: networkStats, isLoading: isNetworkStatsLoading } = useNetworkStats({ enabled: isOpen });
  const mintTokenAmount = networkStats?.mintLimit ?? 1000;
  const [isConfirming, setIsConfirming] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [view, setView] = useState<LockView>('form');
  const [successTxid, setSuccessTxid] = useState<string | null>(null);
  const { toast } = useToast();
  const { user } = useAuth();
  const { isWalletReady } = useWallet();

  const handleOpenChange = (open: boolean) => {
    onOpenChange(open);
  };

  const validateInput = useCallback(() => {
    if (!bsvPrice || isPriceError) {
      toast({ variant: "destructive", title: "Price Error", description: "Cannot confirm lock without BSV price.", duration: 2000 });
      return false;
    }
    if (!user) {
      toast({ variant: "default", title: "Login Required", description: "Please login to continue", duration: 2000 });
      return false;
    }
    if (!isWalletReady) {
      toast({ variant: "default", title: "Wallet Required", description: "Connect a wallet to lock satoshis", duration: 2000 });
      return false;
    }
    if (isContractConfigLoading || contractSats === null || contractBlocks === null) {
      toast({ variant: "default", title: "Loading Contract", description: "Fetching live lock settings from the contract.", duration: 2000 });
      return false;
    }
    if (isContractConfigError) {
      toast({ variant: "destructive", title: "Contract Error", description: "Could not load the contract lock settings.", duration: 2500 });
      return false;
    }
    return true;
  }, [bsvPrice, isPriceError, toast, user, isWalletReady, isContractConfigLoading, contractSats, contractBlocks, isContractConfigError]);

  const handleConfirmClick = async () => {
    if (!isConfirming) {
      if (validateInput()) {
        setIsConfirming(true);
      }
    } else {
      setElapsedSeconds(0);
      setView('processing');
      const txid = await onConfirmLock(contractSats as number, contractBlocks as number);
      setIsConfirming(false);
      if (txid) {
        setSuccessTxid(txid);
        setView('success');
      } else {
        setView('form');
      }
    }
  };

  const handleCancel = () => {
     handleOpenChange(false);
  }

  useEffect(() => {
    let interval: number | undefined;
    if (isLocking) {
      setElapsedSeconds(0);
      interval = window.setInterval(() => {
        setElapsedSeconds((s) => s + 1);
      }, 1000);
    }
    return () => {
      if (interval) window.clearInterval(interval);
    };
  }, [isLocking]);

  const handleLoginClick = () => {
    handleOpenChange(false);
    onRequestLogin?.();
  };

  const confirmDisabled =
    isLocking ||
    !bsvPrice ||
    isPriceError ||
    isContractConfigLoading ||
    isContractConfigError ||
    contractSats === null ||
    contractBlocks === null ||
    isNetworkStatsLoading;

  return (
    <Sheet open={isOpen} onOpenChange={handleOpenChange}>
      <SheetContent
        side="bottom"
        className="z-[200] mx-auto w-full overflow-hidden rounded-t-2xl border-t border-border/60 bg-background/95 p-6 shadow-[0_0_0_1px_rgba(245,158,11,0.2),0_-20px_50px_-20px_rgba(0,0,0,0.55)] backdrop-blur-xl md:w-1/3"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/60 to-transparent"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 left-1/2 h-48 w-48 -translate-x-1/2 rounded-full bg-amber-400/15 blur-3xl"
        />

        <SheetHeader className="relative">
          <SheetTitle className="font-vzn-headings text-2xl font-normal tracking-tight sm:text-3xl">
            Lock, like, <span className={GOLD_TEXT}>mint</span>
          </SheetTitle>
        </SheetHeader>

        {!user ? (
          <div className="relative mt-6 font-post-sans">
            <div className="relative overflow-hidden rounded-2xl border border-amber-400/30 bg-gradient-to-b from-amber-400/[0.08] to-amber-400/[0.02] p-6 text-center backdrop-blur">
              <div
                aria-hidden
                className="pointer-events-none absolute -top-12 right-0 h-28 w-28 rounded-full bg-amber-400/15 blur-3xl"
              />
              <div className="relative flex flex-col items-center gap-3">
                <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-amber-400/40 bg-gradient-to-b from-amber-400/20 to-amber-400/[0.04] text-amber-500 dark:text-amber-300">
                  <Lock className="h-7 w-7" />
                </div>
                <h3 className="font-vzn-headings text-xl font-normal tracking-tight">
                  Authentication required
                </h3>
                <p className="max-w-xs text-sm text-muted-foreground">
                  You need to be logged in to lock satoshis to this post.
                </p>
                <button
                  type="button"
                  onClick={handleLoginClick}
                  className={`${PRIMARY_CTA} mt-1 w-full`}
                >
                  <span className={PRIMARY_CTA_HOVER_OVERLAY} />
                  <span className="relative flex items-center gap-2">
                    <LogIn className="h-4 w-4" />
                    Log in to continue
                  </span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="relative mt-6 space-y-4 font-post-sans">
            <div className="overflow-hidden rounded-2xl border border-border/60 bg-background/60 p-4 backdrop-blur">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    Amount
                  </div>
                  <div className="text-right font-post-mono text-xl font-semibold tabular-nums">
                    {contractSats !== null ? (
                      <>
                        {contractSats.toLocaleString()}
                        <span className="md:block"> sats</span>
                      </>
                    ) : (
                      <ContractValueSpinner label="Loading" />
                    )}
                  </div>
                  {!isPriceError && bsvPrice && contractSats !== null && (
                    <div className="h-4 text-right text-xs text-muted-foreground">
                      {formatUSD(contractSats, bsvPrice)}
                    </div>
                  )}
                  {isPriceError && <div className="h-4 text-right text-xs text-destructive">Price Error</div>}
                  {!isPriceError && (!bsvPrice || contractSats === null) && <div className="h-4" />}
                </div>
                <div className="space-y-1 border-l border-border/60 pl-4">
                  <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    Duration
                  </div>
                  <div className="text-right font-post-mono text-xl font-semibold tabular-nums">
                    {contractBlocks !== null ? (
                      <>
                        {contractBlocks.toLocaleString()}
                        <span className="md:block"> blocks</span>
                      </>
                    ) : (
                      <ContractValueSpinner label="Loading" />
                    )}
                  </div>
                  <div className="h-4 text-right text-xs text-muted-foreground">
                    {contractBlocks !== null
                      ? formatBlocksToTime(contractBlocks).replace('≈', '').replace('d', ' days').replace('w', ' weeks')
                      : isContractConfigLoading ? 'Fetching from contract…' : ''}
                  </div>
                </div>
              </div>
            </div>

            <p className="px-1 text-xs text-muted-foreground">
              {contractSats !== null && contractBlocks !== null
                ? `You are about to lock ${contractSats.toLocaleString()} satoshis for ${contractBlocks.toLocaleString()} blocks. This action is irreversible. Miner and dev fee apply.`
                : 'Loading the live contract lock amount and duration. Miner and dev fee apply.'}
            </p>

            <AnimatePresence mode="wait" initial={false}>
              {view === 'processing' ? (
                <motion.div
                  key="processing"
                  initial={{ opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
                  className="flex flex-col items-center gap-4 py-3"
                  role="status"
                  aria-live="polite"
                >
                  <ThinkingOrb state="composing" size={64} />
                  <div className="text-center">
                    <div className="text-sm font-medium text-foreground">
                      {getTransactionProgressLabel(progress)}…
                    </div>
                    <div className="mt-1 font-post-mono text-[11px] tabular-nums text-muted-foreground">
                      {formatProgressElapsedTime(elapsedSeconds)}
                    </div>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/60">
                    <div
                      className="h-full bg-gradient-to-r from-amber-300 via-amber-400 to-amber-500 transition-[width] duration-150"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </motion.div>
              ) : view === 'success' ? (
                <motion.div
                  key="success"
                  initial={{ opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  className="flex flex-col items-center gap-4 py-3 text-center"
                  role="status"
                  aria-live="polite"
                >
                  <motion.div
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
                    className="flex h-16 w-16 items-center justify-center rounded-full border border-amber-400/50 bg-amber-400/10 text-amber-600 dark:text-amber-300"
                  >
                    <Check className="h-8 w-8 stroke-[2]" aria-hidden />
                  </motion.div>
                  <div>
                    <h3 className="font-vzn-headings text-xl font-normal tracking-tight">
                      Mint successful
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Your VZN was minted and the lock was broadcast.
                    </p>
                    {successTxid && (
                      <a
                        href={`https://bananablocks.com/tx/${successTxid}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mx-auto mt-2 block max-w-[18rem] truncate rounded-sm font-post-mono text-[10px] text-amber-600 underline decoration-amber-400/50 underline-offset-2 transition-colors hover:text-amber-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/60 dark:text-amber-300"
                        title={`View ${successTxid} on BananaBlocks`}
                      >
                        {successTxid}
                      </a>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={handleCancel}
                    className={`${PRIMARY_CTA} min-w-[180px]`}
                  >
                    <span className={PRIMARY_CTA_HOVER_OVERLAY} />
                    <span className="relative">Done</span>
                  </button>
                </motion.div>
              ) : (
                <motion.div
                  key="form-actions"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                  className="flex justify-end gap-2 pt-1"
                >
                  <button
                    type="button"
                    onClick={handleCancel}
                    className={GHOST_PILL}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmClick}
                    disabled={confirmDisabled}
                    className={`${PRIMARY_CTA} min-w-[180px]`}
                  >
                    <span className={PRIMARY_CTA_HOVER_OVERLAY} />
                    <span className="relative flex items-center justify-center gap-2">
                      {isConfirming ? (
                        <span>Confirm</span>
                      ) : isNetworkStatsLoading ? (
                        <>
                          <span>{`Mint ${mintTokenAmount.toLocaleString()}`}</span>
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                        </>
                      ) : (
                        <span>{`Mint ${mintTokenAmount.toLocaleString()} ${formatTokenTicker(networkStats?.symbol ?? '')}`}</span>
                      )}
                    </span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
};
