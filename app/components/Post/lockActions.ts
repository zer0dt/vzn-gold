import { bsv, PubKeyHash, toByteString, TestWallet, type MethodCallOptions } from 'scrypt-ts';
import { OrdiProvider } from 'scrypt-ord';
import { PrivateKey, Hash } from '@bsv/sdk';
import { LockLikeMintBSV21Parallel } from '@/src/contracts/LockLikeMintBSV21Parallel';
import type { Post as PostType } from '@/types';
import { syncLikeAcrossPostCaches, type HydratedPost } from '@/app/lib/supabase/posts';
import { installMintLogCapture } from '@/app/lib/mint-log-capture';
import {
  ensureLlmArtifactPrefetch,
  getPrefetchedFundingState,
  startOverlayMinterBeefPrefetch,
  takePrefetchedOverlayMinter,
} from '@/app/lib/mint-prefetch';
import { MINT_FUNDING_INPUT_HEADROOM_SATS } from '@/app/lib/mint-funding';

type ToastFunction = typeof import('@/app/hooks/use-toast').toast;

/** Same baseline as mint broadcast path. If ARC returns fee-too-low, raise temporarily. */
const MINT_TX_FEE_PER_KB = 150;

type OverlayMinterResponse = {
  txid: string;
  rawtx: string;
  outputIndex: number;
  satoshis: number;
  script: string;
  supply?: string;
  overlayAmount?: string;
  candidateCount?: number;
  timings?: Record<string, unknown>;
};

type PaymentUtxo = {
  txId: string;
  outputIndex: number;
  satoshis: number;
  script: string;
  confirmed?: boolean;
  height?: number | null;
  confirmations?: number | null;
};

type PreparedFundingParent = {
  txid: string;
  rawtx: string;
  merklePathHex: string | null;
};

type FundingParentPrefetchResponse = {
  parents: PreparedFundingParent[];
  skipped?: Array<{ txid: string; reason: string }>;
  elapsedMs?: number;
};

type AvailablePaymentUtxo = {
  satoshis: number;
  txid: string;
  vout: number;
  confirmed: boolean;
  height: number | null;
  confirmations: number | null;
};

type FundingUtxoPrefetchResult =
  | { utxos: AvailablePaymentUtxo[]; error?: never }
  | { utxos?: never; error: unknown };

type PendingMintFundingReservation = {
  key: string;
  reservedAt: number;
};

const PENDING_MINT_FUNDING_UTXOS_KEY = 'pendingMintFundingOutpoints';
const PENDING_MINT_CONTRACT_UTXOS_KEY = 'pendingMintContractOutpoints';
const PENDING_MINT_FUNDING_TTL_MS = 2 * 60 * 1000;

function toFundingOutpointKey(txId: string, outputIndex: number): string {
  return `${txId}:${outputIndex}`;
}

function readPendingMintFundingReservations(): PendingMintFundingReservation[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.sessionStorage.getItem(PENDING_MINT_FUNDING_UTXOS_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as PendingMintFundingReservation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePendingMintFundingReservations(reservations: PendingMintFundingReservation[]): void {
  if (typeof window === 'undefined') {
    return;
  }

  if (reservations.length === 0) {
    window.sessionStorage.removeItem(PENDING_MINT_FUNDING_UTXOS_KEY);
    return;
  }

  window.sessionStorage.setItem(PENDING_MINT_FUNDING_UTXOS_KEY, JSON.stringify(reservations));
}

function prunePendingMintFundingReservations(): PendingMintFundingReservation[] {
  const now = Date.now();
  const reservations = readPendingMintFundingReservations().filter((reservation) => {
    return now - reservation.reservedAt < PENDING_MINT_FUNDING_TTL_MS;
  });

  writePendingMintFundingReservations(reservations);
  return reservations;
}

function getPendingMintFundingOutpointKeys(): string[] {
  return prunePendingMintFundingReservations().map((reservation) => reservation.key);
}

function reservePendingMintFundingOutpointKeys(keys: string[]): void {
  if (keys.length === 0) {
    return;
  }

  const now = Date.now();
  const reservations = prunePendingMintFundingReservations();
  const merged = new Map(reservations.map((reservation) => [reservation.key, reservation]));

  keys.forEach((key) => {
    merged.set(key, { key, reservedAt: now });
  });

  writePendingMintFundingReservations(Array.from(merged.values()));
}

function releasePendingMintFundingOutpointKeys(keys: string[]): void {
  if (keys.length === 0) {
    return;
  }

  const keySet = new Set(keys);
  const reservations = prunePendingMintFundingReservations().filter((reservation) => {
    return !keySet.has(reservation.key);
  });

  writePendingMintFundingReservations(reservations);
}

function readPendingMintContractReservations(): PendingMintFundingReservation[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.sessionStorage.getItem(PENDING_MINT_CONTRACT_UTXOS_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as PendingMintFundingReservation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePendingMintContractReservations(reservations: PendingMintFundingReservation[]): void {
  if (typeof window === 'undefined') {
    return;
  }

  if (reservations.length === 0) {
    window.sessionStorage.removeItem(PENDING_MINT_CONTRACT_UTXOS_KEY);
    return;
  }

  window.sessionStorage.setItem(PENDING_MINT_CONTRACT_UTXOS_KEY, JSON.stringify(reservations));
}

function prunePendingMintContractReservations(): PendingMintFundingReservation[] {
  const now = Date.now();
  const reservations = readPendingMintContractReservations().filter((reservation) => {
    return now - reservation.reservedAt < PENDING_MINT_FUNDING_TTL_MS;
  });

  writePendingMintContractReservations(reservations);
  return reservations;
}

function getPendingMintContractOutpointKeys(): string[] {
  return prunePendingMintContractReservations().map((reservation) => reservation.key);
}

function reservePendingMintContractOutpointKey(key: string): void {
  const now = Date.now();
  const reservations = prunePendingMintContractReservations();
  const merged = new Map(reservations.map((reservation) => [reservation.key, reservation]));
  merged.set(key, { key, reservedAt: now });
  writePendingMintContractReservations(Array.from(merged.values()));
}

function releasePendingMintContractOutpointKey(key: string | null): void {
  if (!key) {
    return;
  }

  const reservations = prunePendingMintContractReservations().filter((reservation) => {
    return reservation.key !== key;
  });

  writePendingMintContractReservations(reservations);
}

async function fetchBlockHeight(preferredBlockHeight?: number): Promise<number> {
  if (typeof preferredBlockHeight === 'number' && preferredBlockHeight > 0) {
    return preferredBlockHeight;
  }

  const response = await fetch('/api/block-height', {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch block height: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const latestBlockHeight = data.height || data.blocks || data.blockHeight || 0;

  if (typeof latestBlockHeight !== 'number' || latestBlockHeight <= 0) {
    throw new Error('Block height response is invalid');
  }

  return latestBlockHeight;
}

export async function handleConfirmLockAction(params: {
  satsToLock: number;
  blocksToLock: number;
  post: PostType;
  blockHeight?: number;
  supabase: any;
  queryClient: any;
  toast: ToastFunction;
  walletContext: any;
  user: { id: string } | null | undefined;
  setIsProcessing: (v: boolean) => void;
  setProgress: (v: number) => void;
}): Promise<string | null> {
  installMintLogCapture();

  const {
    satsToLock,
    blocksToLock,
    post,
    blockHeight,
    supabase,
    queryClient,
    toast,
    walletContext,
    user,
    setIsProcessing,
    setProgress,
  } = params;


  const { walletAddress: senderWalletAddress, isWalletReady } = walletContext || {};
  const ownerKey = typeof window !== 'undefined' ? window.sessionStorage.getItem('ownerKey') : null;
  const paymentKey = typeof window !== 'undefined' ? window.sessionStorage.getItem('walletKey') : null;

  if (!user) {
    toast({
      variant: 'destructive',
      title: 'Authentication Required',
      description: 'Please log in to lock satoshis on this post.',
      duration: 3000,
    });
    return null;
  }

  if (!ownerKey || !senderWalletAddress) {
    toast({
      variant: 'destructive',
      title: 'Wallet Setup Required',
      description: 'Wallet setup is incomplete. Please set up your wallet first.',
      duration: 3000,
    });
    return null;
  }

  if (!isWalletReady) {
    toast({
      variant: 'default',
      title: 'Wallet Required',
      description: 'Posting is free, but connect a wallet to sign your posts',
      duration: 2000,
    });
    return null;
  }

  setIsProcessing(true);
  setProgress(25);
  let reservedFundingOutpointKeys: string[] = [];
  let reservedContractOutpointKey: string | null = null;
  let keepFundingReservations = false;
  let keepContractReservation = false;
  const mintId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const mintStartedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const mintStartedAtIso = new Date().toISOString();
  let lastMintTimingAt = mintStartedAt;
  const mintTiming = (stepStartedAt?: number, options?: { mark?: boolean }) => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const timing = {
      stepMs: stepStartedAt === undefined ? undefined : Math.round(now - stepStartedAt),
      sinceLastMs: Math.round(now - lastMintTimingAt),
      totalMs: Math.round(now - mintStartedAt),
    };
    if (options?.mark !== false) {
      lastMintTimingAt = now;
    }
    return timing;
  };
  console.log('[mint-beef] mint start', {
    mintId,
    startedAt: mintStartedAtIso,
    timing: mintTiming(undefined, { mark: false }),
  });

  try {
    async function fetchLiveMinterFromOverlay(originId: string): Promise<OverlayMinterResponse> {
      const tMinter0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const excludedKeys = getPendingMintContractOutpointKeys();
      const prefetched = await takePrefetchedOverlayMinter({ originId, excludeKeys: excludedKeys });
      if (prefetched) {
        const data = prefetched.data;
        console.log('[mint-beef] selected overlay minter', {
          mintId,
          txid: data.txid,
          outputIndex: data.outputIndex,
          supply: data.supply,
          overlayAmount: data.overlayAmount,
          candidateCount: data.candidateCount,
          serverTimings: data.timings,
          rawtxLength: data.rawtx.length,
          fromPrefetch: true,
          prefetchAgeMs: prefetched.ageMs,
          prefetchWaitMs: prefetched.waitMs,
          timing: mintTiming(tMinter0),
        });

        return data;
      }

      const excluded = excludedKeys
        .map((key) => `exclude=${encodeURIComponent(key)}`)
        .join('&');
      const res = await fetch(
        `/api/overlay/minters?originId=${encodeURIComponent(originId)}${excluded ? `&${excluded}` : ''}`,
        { cache: 'no-store' }
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || `Failed to fetch overlay minter: ${res.status} ${res.statusText}`);
      }

      const data = (await res.json()) as OverlayMinterResponse;
      if (!data?.txid || data.outputIndex === undefined || !data.rawtx || data.satoshis === undefined || !data.script) {
        throw new Error('Overlay minter response is incomplete');
      }

      console.log('[mint-beef] selected overlay minter', {
        mintId,
        txid: data.txid,
        outputIndex: data.outputIndex,
        supply: data.supply,
        overlayAmount: data.overlayAmount,
        candidateCount: data.candidateCount,
        serverTimings: data.timings,
        rawtxLength: data.rawtx.length,
        fromPrefetch: false,
        timing: mintTiming(tMinter0),
      });

      return data;
    }

    const originId = process.env.NEXT_PUBLIC_LLM21_ORIGIN_ID as string | undefined;
    if (!originId) {
      throw new Error('LLM-21 origin not configured');
    }

    const fundingAddress = walletContext.walletAddress;
    let fundingParentPrefetchPromise: Promise<FundingParentPrefetchResponse> | null = null;
    const startFundingParentPrefetch = (
      fundingParentTxids: string[],
      phase: 'early' | 'exact'
    ): Promise<FundingParentPrefetchResponse> => {
      const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
      console.log('[mint-beef] funding parent prefetch start', {
        mintId,
        phase,
        fundingParentTxids,
        timing: mintTiming(undefined, { mark: false }),
      });

      return (async () => {
        try {
          const res = await fetch('/api/beef-cache', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fundingParentTxids }),
          });
          const elapsedMs = Math.round(
            (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt
          );
          if (!res.ok) {
            console.warn('[mint-beef] funding parent prefetch failed', {
              mintId,
              phase,
              status: res.status,
              statusText: res.statusText,
              elapsedMs,
            });
            return { parents: [], skipped: [], elapsedMs };
          }
          const body = (await res.json()) as FundingParentPrefetchResponse;
          return {
            parents: Array.isArray(body.parents) ? body.parents : [],
            skipped: Array.isArray(body.skipped) ? body.skipped : [],
            elapsedMs,
          };
        } catch (error) {
          const elapsedMs = Math.round(
            (typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt
          );
          console.warn('[mint-beef] funding parent prefetch threw', {
            mintId,
            phase,
            error,
            elapsedMs,
          });
          return { parents: [], skipped: [], elapsedMs };
        }
      })();
    };

    const tFundingFetch0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const walletPaymentModulePromise = import('@/app/lib/wallet-payment');
    const excludedFundingKeysAtStart = getPendingMintFundingOutpointKeys();
    const prefetchedFundingState = getPrefetchedFundingState({
      fundingAddress,
      satsToLock,
      excludeKeys: excludedFundingKeysAtStart,
    });
    const availableFundingUtxosPromise: Promise<FundingUtxoPrefetchResult> =
      prefetchedFundingState?.availableFundingUtxosPromise ??
      walletPaymentModulePromise
        .then(({ fetchAvailablePaymentUTXOs }) =>
          (fetchAvailablePaymentUTXOs(fundingAddress) as Promise<AvailablePaymentUtxo[]>).then((utxos) => ({ utxos }))
        )
        .catch((error) => ({ error }));
    console.log('[mint-beef] funding UTXOs prefetch start', {
      mintId,
      fundingAddress,
      fromPrefetch: Boolean(prefetchedFundingState),
      prefetchAgeMs: prefetchedFundingState?.ageMs,
      timing: mintTiming(undefined, { mark: false }),
    });
    const earlyFundingParentPrefetchPromise =
      prefetchedFundingState?.earlyFundingParentPrefetchPromise ??
      Promise.all([
        walletPaymentModulePromise,
        availableFundingUtxosPromise,
      ])
        .then(([{ selectPaymentUTXOs }, availableResult]) => {
          if ('error' in availableResult) {
            return null;
          }

          // Match prepared mint packs: lock + headroom. Service fee / dust are paid from
          // headroom slack — do not inflate past an exact pack or we double-spend a second UTXO.
          const preliminaryRequiredSatoshis = Math.max(
            1,
            satsToLock + MINT_FUNDING_INPUT_HEADROOM_SATS
          );
          const preliminaryUtxos = selectPaymentUTXOs(
            fundingAddress,
            preliminaryRequiredSatoshis,
            availableResult.utxos,
            excludedFundingKeysAtStart
          ) as PaymentUtxo[];
          if (preliminaryUtxos.length === 0) {
            return null;
          }

          const outpointKeys = preliminaryUtxos.map((utxo) =>
            toFundingOutpointKey(utxo.txId, utxo.outputIndex)
          );
          const fundingParentTxids = Array.from(
            new Set(preliminaryUtxos.map((utxo) => utxo.txId).filter(Boolean))
          );
          return {
            outpointKeys,
            fundingParentTxids,
            prefetchPromise: startFundingParentPrefetch(fundingParentTxids, 'early'),
          };
        })
        .catch((error) => {
          console.warn('[mint-beef] early funding parent selection failed', { mintId, error });
          return null;
        });

    const tInitialLookup0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const [, latestBlockHeight, selectedMinter] = await Promise.all([
      ensureLlmArtifactPrefetch(),
      fetchBlockHeight(blockHeight),
      fetchLiveMinterFromOverlay(originId),
    ]);
    console.log('[mint-beef] initial lookup complete', {
      mintId,
      latestBlockHeight,
      usedPropBlockHeight: typeof blockHeight === 'number' && blockHeight > 0,
      timing: mintTiming(tInitialLookup0),
    });

    const overlayMinterBeefPrefetchPromise = startOverlayMinterBeefPrefetch({
      originId,
      txid: selectedMinter.txid,
    });

    reservedContractOutpointKey = toFundingOutpointKey(selectedMinter.txid, selectedMinter.outputIndex);
    reservePendingMintContractOutpointKey(reservedContractOutpointKey);

    const fromUTXO = {
      txId: selectedMinter.txid,
      outputIndex: selectedMinter.outputIndex,
      satoshis: selectedMinter.satoshis,
      script: selectedMinter.script,
    };

    const parsedFromTx = new bsv.Transaction(selectedMinter.rawtx);


    const latestContract = LockLikeMintBSV21Parallel.fromUTXO(fromUTXO);

    if (!paymentKey) {
      throw new Error('Wallet key not found');
    }
    const provider = new OrdiProvider();
    
    const signer = new TestWallet(bsv.PrivateKey.fromWIF(paymentKey), provider);
    await latestContract.connect(signer);

    // Derive lockPkh from paymentKey (for funding/locking satoshis)
    const payPriv = PrivateKey.fromWif(paymentKey);
    const payPub = payPriv.toPublicKey();
    const payPkhHex = Buffer.from(Hash.hash160(payPub.toDER())).toString('hex');
    const lockPkh = PubKeyHash(toByteString(payPkhHex));

    // Derive rewardPkh from ownerKey (for receiving minted VZN)
    const ownerPriv = PrivateKey.fromWif(ownerKey);
    const ownerPub = ownerPriv.toPublicKey();
    const ownerPkhHex = Buffer.from(Hash.hash160(ownerPub.toDER())).toString('hex');
    const rewardPkh = PubKeyHash(toByteString(ownerPkhHex));

    const likedTxid = toByteString(post.txid, true);
    const appName = toByteString(process.env.NEXT_PUBLIC_APP_NAME || 'bitcoin', true);
    const contractSats = Number(latestContract.sats);
    const contractBlocks = Number(latestContract.blocks);

    if (satsToLock !== contractSats || blocksToLock !== contractBlocks) {
      console.warn('Lock config mismatch; using contract values', {
        requestedSatsToLock: satsToLock,
        contractSats,
        requestedBlocksToLock: blocksToLock,
        contractBlocks,
      });
    }

    setProgress(50);
    const lockAmount = BigInt(contractSats);
    const nextContractOutputIndex =
      latestContract.supply - latestContract.calculateReward(lockAmount) > BigInt(0) ? 0 : undefined;

    const { tx: builtTx } = await (LockLikeMintBSV21Parallel as any).buildTxForMint(
      latestContract,
      {
        lockTime: latestBlockHeight,
        sequence: 0xfffffffe,
        changeAddress: fundingAddress,
      } as MethodCallOptions<any>,
      lockPkh,
      rewardPkh,
      lockAmount,
      likedTxid,
      appName
    );

    let fundingAdded = false;
    try {
      const tFunding0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const { selectPaymentUTXOs } = await walletPaymentModulePromise;
      const excludedOutpointsBeforeFundingFetch = getPendingMintFundingOutpointKeys();
      console.log('[mint-beef] funding UTXOs select start', {
        mintId,
        excludedPendingOutpointCount: excludedOutpointsBeforeFundingFetch.length,
        fundingAddress,
        timing: mintTiming(undefined, { mark: false }),
      });
      const outputSatoshis = builtTx.outputs.reduce((sum: number, output: any) => sum + output.satoshis, 0);
      // Same target as Prepare UTXOs / preliminary select (lock + headroom). Adding
      // service-fee/dust on top of headroom was overshooting exact packs by a few hundred sats
      // and forcing a useless second funding input + large change.
      const requiredFundingSatoshis = Math.max(
        1,
        satsToLock + MINT_FUNDING_INPUT_HEADROOM_SATS
      );
      const availableFundingUtxosResult = await availableFundingUtxosPromise;
      if ('error' in availableFundingUtxosResult) {
        throw availableFundingUtxosResult.error;
      }
      const availableFundingUtxos = availableFundingUtxosResult.utxos;
      console.log('[mint-beef] funding UTXOs prefetch ready', {
        mintId,
        availableCount: availableFundingUtxos.length,
        waitMs: Math.round(
          (typeof performance !== 'undefined' ? performance.now() : Date.now()) - tFundingFetch0
        ),
        timing: mintTiming(undefined, { mark: false }),
      });
      const fundingUtxos = selectPaymentUTXOs(
        fundingAddress,
        requiredFundingSatoshis,
        availableFundingUtxos,
        getPendingMintFundingOutpointKeys()
      ) as PaymentUtxo[];

      if (!fundingUtxos.length) {
        setProgress(0);
        toast({
          variant: 'destructive',
          title: 'Insufficient Funds',
          description: 'No fresh funding UTXOs were found for your wallet. Please wait for confirmation or fund it and try again.',
          duration: 4000,
        });
        return null;
      }

      const fundingParentTxids = Array.from(new Set(fundingUtxos.map((utxo) => utxo.txId).filter(Boolean)));
      const exactOutpointKeys = fundingUtxos
        .map((utxo) => toFundingOutpointKey(utxo.txId, utxo.outputIndex))
        .sort();
      const earlyPrefetch = await earlyFundingParentPrefetchPromise;
      const earlyOutpointKeys = earlyPrefetch?.outpointKeys.slice().sort() ?? [];
      const canReuseEarlyPrefetch =
        earlyPrefetch !== null &&
        earlyOutpointKeys.length === exactOutpointKeys.length &&
        earlyOutpointKeys.every((key, index) => key === exactOutpointKeys[index]);

      if (canReuseEarlyPrefetch) {
        fundingParentPrefetchPromise = earlyPrefetch.prefetchPromise;
        console.log('[mint-beef] funding parent prefetch reused', {
          mintId,
          fundingParentTxids,
          timing: mintTiming(undefined, { mark: false }),
        });
      } else {
        fundingParentPrefetchPromise = startFundingParentPrefetch(fundingParentTxids, 'exact');
        console.log('[mint-beef] funding parent prefetch selection changed', {
          mintId,
          earlyFundingParentTxids: earlyPrefetch?.fundingParentTxids ?? [],
          fundingParentTxids,
          timing: mintTiming(undefined, { mark: false }),
        });
      }

      reservedFundingOutpointKeys = fundingUtxos.map((utxo) => {
        return toFundingOutpointKey(utxo.txId, utxo.outputIndex);
      });
      reservePendingMintFundingOutpointKeys(reservedFundingOutpointKeys);

      builtTx.from(fundingUtxos);
      builtTx.feePerKb(MINT_TX_FEE_PER_KB);
      builtTx.change(fundingAddress);
      fundingAdded = true;

      const fundingSatSum = fundingUtxos.reduce((sum, u) => sum + u.satoshis, 0);
      console.log('[mint-beef] funding UTXOs attached', {
        mintId,
        count: fundingUtxos.length,
        fundingSatSum,
        requiredFundingSatoshis,
        outputSatoshis,
        reservedOutpoints: reservedFundingOutpointKeys.length,
        excludedPendingOutpointCountBeforeFetch: excludedOutpointsBeforeFundingFetch.length,
        selectedMinterTxid: selectedMinter.txid,
        selectedMinterRawtxChars: selectedMinter.rawtx.length,
        fundingParentTxids,
        fundingUtxos: fundingUtxos.map((utxo) => ({
          txid: utxo.txId,
          vout: utxo.outputIndex,
          satoshis: utxo.satoshis,
          confirmed: utxo.confirmed,
          height: utxo.height,
          confirmations: utxo.confirmations,
        })),
        timing: mintTiming(tFunding0),
      });
    } catch (e) {
      console.warn('Error adding funding input:', e);
      setProgress(0);
      toast({
        variant: 'destructive',
        title: 'Funding Input Error',
        description: 'Could not add the funding input. The mint BEEF must include it. Please try again.',
        duration: 4000,
      });
      return null;
    }

    const tUnlock0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const unlockingScript = await latestContract.getUnlockingScript(async (self: any) => {
      (self as any).to = { tx: builtTx, inputIndex: 0 };
      (self as any).from = { tx: parsedFromTx, outputIndex: fromUTXO.outputIndex };
      (self as any).mint(lockPkh, rewardPkh, lockAmount, likedTxid, appName);
    });
    const tUnlock1 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const unlockingAsm = unlockingScript.toASM();
    console.log('[mint-beef] unlock script', {
      mintId,
      ms: Math.round(tUnlock1 - tUnlock0),
      asmChars: unlockingAsm.length,
      inputCount: builtTx.inputs.length,
      outputCount: builtTx.outputs.length,
      timing: mintTiming(tUnlock0),
    });

    builtTx.inputs[0].setScript(bsv.Script.fromASM(unlockingAsm));

    const tSign0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (fundingAdded) {
      builtTx.sign(bsv.PrivateKey.fromWIF(paymentKey));
    }
    const tSign1 = typeof performance !== 'undefined' ? performance.now() : Date.now();

    const rawtx = builtTx.toString();
    console.log('[mint-beef] tx serialized (pre-beef-cache)', {
      mintId,
      signMs: fundingAdded ? Math.round(tSign1 - tSign0) : 0,
      rawtxChars: rawtx.length,
      inputCount: builtTx.inputs.length,
      outputCount: builtTx.outputs.length,
      fundingAdded,
      timing: mintTiming(tSign0),
    });

    // Server builds BEEF and submits it directly so the browser never shuttles the multi-MB BEEF.
    setProgress(60);
    let txid: string = '';
    let newLikeData: { txid: string } & Record<string, unknown> | null = null;

    try {
      const overlayTopic = `tm_${originId}`;
      const tBeefSubmit0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const tFundingParentWait0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const prefetchedFundingParents = fundingParentPrefetchPromise
        ? await fundingParentPrefetchPromise
        : { parents: [], skipped: [], elapsedMs: 0 };
      console.log('[mint-beef] funding parent prefetch ready', {
        mintId,
        parentCount: prefetchedFundingParents.parents.length,
        skippedCount: prefetchedFundingParents.skipped?.length ?? 0,
        prefetchElapsedMs: prefetchedFundingParents.elapsedMs ?? 0,
        waitMs: Math.round(
          (typeof performance !== 'undefined' ? performance.now() : Date.now()) -
            tFundingParentWait0
        ),
        timing: mintTiming(undefined, { mark: false }),
      });
      const overlayMinterBeefPrefetch = await overlayMinterBeefPrefetchPromise;
      console.log('[mint-beef] beef-cache build+submit POST start', {
        mintId,
        rawtxChars: rawtx.length,
        selectedMinterTxid: selectedMinter.txid,
        prefetchedFundingParentCount: prefetchedFundingParents.parents.length,
        overlayMinterBeefPrefetchMs: overlayMinterBeefPrefetch.elapsedMs,
        overlayMinterBeefPrefetched: overlayMinterBeefPrefetch.prefetched,
        overlayMinterBeefPrefetchSource: overlayMinterBeefPrefetch.source,
        overlayMinterBeefBase64Chars: overlayMinterBeefPrefetch.beefBase64Chars ?? 0,
        overlayMinterBeefFromPrefetch: overlayMinterBeefPrefetch.fromPrefetch,
        overlayMinterBeefPrefetchAgeMs: overlayMinterBeefPrefetch.ageMs,
        timing: mintTiming(undefined, { mark: false }),
      });
      setProgress(80);
      const res = await fetch('/api/beef-cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawtx,
          originId,
          selectedMinterTxid: selectedMinter.txid,
          fundingParents: prefetchedFundingParents.parents,
          submitOverlay: true,
          topics: [overlayTopic],
          likeSubmit: {
            contractId: originId,
            contractInputTxid: selectedMinter.txid,
            contractInputVout: selectedMinter.outputIndex,
            contractOutputVout: nextContractOutputIndex ?? null,
            postTxid: post.txid,
            satsAmount: contractSats,
            blocksLocked: contractBlocks,
            blockHeight: latestBlockHeight,
            unlockHeight: latestBlockHeight + contractBlocks,
            rewardAmount: Number(latestContract.calculateReward(lockAmount)),
          },
        }),
      });
      const tBeefSubmit1 = typeof performance !== 'undefined' ? performance.now() : Date.now();

      const data = (await res.json().catch(() => ({}))) as {
        txid?: string
        overlay?: unknown
        topics?: string[]
        like?: { txid: string } & Record<string, unknown>
        error?: string
        overlayAccepted?: boolean
        timings?: {
          buildBeefMs?: number
          overlaySubmitMs?: number
          likePersistMs?: number
          [key: string]: unknown
        }
      };

      if (!res.ok) {
        console.warn('[mint-beef] beef-cache build+submit failed', {
          mintId,
          status: res.status,
          statusText: res.statusText,
          ms: Math.round(tBeefSubmit1 - tBeefSubmit0),
          response: data,
        });
        if (data.overlayAccepted && typeof data.txid === 'string') {
          const tRecovery0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
          const recoveryResponse = await fetch('/api/likes/submit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              txid: data.txid,
              rawtx,
              contractId: originId,
              contractInputTxid: selectedMinter.txid,
              contractInputVout: selectedMinter.outputIndex,
              contractOutputVout: nextContractOutputIndex ?? null,
              postTxid: post.txid,
              satsAmount: contractSats,
              blocksLocked: contractBlocks,
              blockHeight: latestBlockHeight,
              unlockHeight: latestBlockHeight + contractBlocks,
              rewardAmount: Number(latestContract.calculateReward(lockAmount)),
            }),
          });
          const recoveryBody = (await recoveryResponse.json().catch(() => ({}))) as {
            like?: { txid: string } & Record<string, unknown>;
            error?: string;
          };
          console.log('[mint-beef] like persistence recovery', {
            mintId,
            txid: data.txid,
            status: recoveryResponse.status,
            ok: recoveryResponse.ok,
            timing: mintTiming(tRecovery0),
          });
          if (recoveryResponse.ok && recoveryBody.like) {
            txid = data.txid;
            newLikeData = recoveryBody.like;
          } else {
            throw new Error(recoveryBody.error || data.error || 'Failed to persist like after overlay submit');
          }
        } else {
          const broadcastError =
            typeof (data.overlay as { message?: unknown } | undefined)?.message === 'string'
                ? ((data.overlay as { message: string }).message)
              : typeof (data.overlay as { error?: unknown } | undefined)?.error === 'string'
                ? ((data.overlay as { error: string }).error)
              : typeof data.error === 'string'
                ? data.error
                : undefined;
          throw new Error(
            broadcastError ?? `Overlay submit failed: ${res.status} ${res.statusText}`
          );
        }
      }

      if (!newLikeData) {
        txid = typeof data.txid === 'string' ? data.txid : '';
        newLikeData = data.like ?? null;
      }

      console.log('[mint-beef] beef-cache build+submit ok', {
        mintId,
        txid,
        httpStatus: res.status,
        overlay: data.overlay,
        topics: data.topics,
        timings: data.timings,
        response: data,
        timing: mintTiming(tBeefSubmit0),
      });

      if (!txid) {
        throw new Error('No TXID returned from overlay submit');
      }
      if (!newLikeData) {
        throw new Error('No persisted like returned from overlay submit');
      }

      setProgress(95);
      keepFundingReservations = true;
      keepContractReservation = true;
      const balanceRefresh = walletContext.fetchDetailedBalance?.();
      if (balanceRefresh) {
        void balanceRefresh.catch((balanceError: unknown) => {
          console.warn('mint - failed to refresh wallet balance after broadcast', balanceError);
        });
      }

    } catch (e: any) {
      console.warn('mint - broadcast failed:', e);
      toast({
        variant: 'destructive',
        title: 'Overlay Submit Failed',
        description: e instanceof Error ? e.message : 'Could not submit transaction to the overlay.',
        duration: 4000,
      });
      throw e;
    }

    if (!newLikeData) {
      throw new Error('Failed to save like');
    }

    syncLikeAcrossPostCaches(
      queryClient,
      post.txid,
      newLikeData as NonNullable<HydratedPost['likes']>[number]
    );

    setProgress(100);
    console.log('[mint-beef] mint complete', {
      mintId,
      txid,
      timing: mintTiming(),
    });

    return txid;
  } catch (error: any) {
    console.error('Error locking like:', error);
    setProgress(0);
    toast({
      variant: 'destructive',
      title: 'Error Locking Like',
      description: error?.message || error?.toString() || 'Failed to lock like. Please try again.',
      duration: 5000,
    });
    return null;
  } finally {
    if (!keepFundingReservations && reservedFundingOutpointKeys.length > 0) {
      releasePendingMintFundingOutpointKeys(reservedFundingOutpointKeys);
    }
    if (!keepContractReservation) {
      releasePendingMintContractOutpointKey(reservedContractOutpointKey);
    }
    setIsProcessing(false);
  }
}


