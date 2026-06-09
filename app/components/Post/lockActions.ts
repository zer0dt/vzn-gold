import { bsv, PubKeyHash, toByteString, TestWallet, type MethodCallOptions } from 'scrypt-ts';
import { OrdiProvider } from 'scrypt-ord';
import { PrivateKey, Hash } from '@bsv/sdk';
import { LockLikeMintBSV21Parallel } from '@/src/contracts/LockLikeMintBSV21Parallel';
import llmArtifact from '@/artifacts/LockLikeMintBSV21Parallel.json';
import type { Post as PostType } from '@/types';

let llmArtifactLoadPromise: Promise<unknown> | null = null;
function ensureLlmArtifactLoaded(): Promise<unknown> {
  if (!llmArtifactLoadPromise) {
    llmArtifactLoadPromise = Promise.resolve(LockLikeMintBSV21Parallel.loadArtifact(llmArtifact as any));
  }
  return llmArtifactLoadPromise;
}
type ToastFunction = typeof import('@/app/hooks/use-toast').toast;

/** Extra sats required from funding inputs beyond (outputs − contract UTXO); pays miner fee + ARC relay floor (HTTP 465 below ~15k). */
const MINT_FUNDING_INPUT_HEADROOM_SATS = 25_000;
/** Same baseline as `app/api/sign-and-pay` / `unlockCoins` (100 sat/KB). If ARC returns fee-too-low, raise temporarily. */
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

async function fetchFreshBlockHeight(): Promise<number> {
  const response = await fetch('/api/block-height?fresh=1', {
    cache: 'no-store',
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch fresh block height: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const latestBlockHeight = data.height || data.blocks || data.blockHeight || 0;

  if (typeof latestBlockHeight !== 'number' || latestBlockHeight <= 0) {
    throw new Error('Fresh block height response is invalid');
  }

  return latestBlockHeight;
}

export async function handleConfirmLockAction(params: {
  satsToLock: number;
  blocksToLock: number;
  post: PostType;
  supabase: any;
  queryClient: any;
  toast: ToastFunction;
  walletContext: any;
  user: { id: string } | null | undefined;
  setIsProcessing: (v: boolean) => void;
  setProgress: (v: number) => void;
  setIsLockSheetOpen: (v: boolean) => void;
}) {
  const {
    satsToLock,
    blocksToLock,
    post,
    supabase,
    queryClient,
    toast,
    walletContext,
    user,
    setIsProcessing,
    setProgress,
    setIsLockSheetOpen,
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
    return;
  }

  if (!ownerKey || !senderWalletAddress) {
    toast({
      variant: 'destructive',
      title: 'Wallet Setup Required',
      description: 'Wallet setup is incomplete. Please set up your wallet first.',
      duration: 3000,
    });
    return;
  }

  if (!isWalletReady) {
    toast({
      variant: 'default',
      title: 'Wallet Required',
      description: 'Posting is free, but connect a wallet to sign your posts',
      duration: 2000,
    });
    return;
  }

  setIsProcessing(true);
  setProgress(25);
  let reservedFundingOutpointKeys: string[] = [];
  let reservedContractOutpointKey: string | null = null;
  let keepFundingReservations = false;
  let keepContractReservation = false;
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
    startedAt: mintStartedAtIso,
    timing: mintTiming(undefined, { mark: false }),
  });

  try {
    async function fetchLiveMinterFromOverlay(originId: string): Promise<OverlayMinterResponse> {
      const tMinter0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const excluded = getPendingMintContractOutpointKeys()
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
        txid: data.txid,
        outputIndex: data.outputIndex,
        supply: data.supply,
        overlayAmount: data.overlayAmount,
        candidateCount: data.candidateCount,
        rawtxLength: data.rawtx.length,
        timing: mintTiming(tMinter0),
      });

      return data;
    }

    const originId = process.env.NEXT_PUBLIC_LLM21_ORIGIN_ID as string | undefined;
    if (!originId) {
      throw new Error('LLM-21 origin not configured');
    }

    const [, latestBlockHeight, selectedMinter] = await Promise.all([
      ensureLlmArtifactLoaded(),
      fetchFreshBlockHeight(),
      fetchLiveMinterFromOverlay(originId),
    ]);

    const tOverlayMinterBeef0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const overlayMinterBeefPrefetchPromise = (async (): Promise<{
      prefetched: boolean;
      elapsedMs: number;
      source?: string;
      beefBase64Chars?: number;
    }> => {
      try {
        const res = await fetch(
          `/api/overlay/parent-beef?originId=${encodeURIComponent(originId)}&txid=${encodeURIComponent(selectedMinter.txid)}`,
          { cache: 'no-store' }
        );
        const elapsedMs = Math.round(
          (typeof performance !== 'undefined' ? performance.now() : Date.now()) - tOverlayMinterBeef0
        );
        if (!res.ok) {
          console.warn('[mint-beef] overlay minter BEEF prefetch failed', {
            status: res.status,
            statusText: res.statusText,
            elapsedMs,
            txid: selectedMinter.txid,
          });
          return { prefetched: false, elapsedMs };
        }
        const body = (await res.json()) as {
          prefetched?: boolean;
          elapsedMs?: number;
          source?: string;
          beefBase64Chars?: number;
        };
        console.log('[mint-beef] overlay minter BEEF prefetch ok', {
          elapsedMs: body.elapsedMs ?? elapsedMs,
          beefBase64Chars: body.beefBase64Chars ?? 0,
          prefetched: Boolean(body.prefetched),
          source: body.source,
          txid: selectedMinter.txid,
        });
        return {
          prefetched: Boolean(body.prefetched),
          elapsedMs: body.elapsedMs ?? elapsedMs,
          source: body.source,
          beefBase64Chars: body.beefBase64Chars,
        };
      } catch (error) {
        const elapsedMs = Math.round(
          (typeof performance !== 'undefined' ? performance.now() : Date.now()) - tOverlayMinterBeef0
        );
        console.warn('[mint-beef] overlay minter BEEF prefetch threw', { error, elapsedMs });
        return { prefetched: false, elapsedMs };
      }
    })();

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
      } as MethodCallOptions<any>,
      lockPkh,
      rewardPkh,
      lockAmount,
      likedTxid,
      appName
    );

    let fundingAdded = false;
    let fundingParentPrefetchPromise: Promise<FundingParentPrefetchResponse> | null = null;
    try {
      const tFunding0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const fundingAddress = walletContext.walletAddress;
      const { getPaymentUTXOs } = await import('@/app/lib/wallet-payment');
      const excludedOutpointsBeforeFundingFetch = getPendingMintFundingOutpointKeys();
      console.log('[mint-beef] funding UTXOs fetch start', {
        excludedPendingOutpointCount: excludedOutpointsBeforeFundingFetch.length,
        fundingAddress,
        timing: mintTiming(undefined, { mark: false }),
      });
      const outputSatoshis = builtTx.outputs.reduce((sum: number, output: any) => sum + output.satoshis, 0);
      const requiredFundingSatoshis = Math.max(
        1,
        outputSatoshis - fromUTXO.satoshis + MINT_FUNDING_INPUT_HEADROOM_SATS
      );
      const fundingUtxos = (await getPaymentUTXOs(
        fundingAddress,
        requiredFundingSatoshis,
        getPendingMintFundingOutpointKeys()
      )) as PaymentUtxo[];

      if (!fundingUtxos.length) {
        setProgress(0);
        toast({
          variant: 'destructive',
          title: 'Insufficient Funds',
          description: 'No fresh funding UTXOs were found for your wallet. Please wait for confirmation or fund it and try again.',
          duration: 4000,
        });
        return;
      }

      const fundingParentTxids = Array.from(new Set(fundingUtxos.map((utxo) => utxo.txId).filter(Boolean)));
      const tFundingParentPrefetch0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
      console.log('[mint-beef] funding parent prefetch start', {
        fundingParentTxids,
        timing: mintTiming(undefined, { mark: false }),
      });
      fundingParentPrefetchPromise = (async () => {
        try {
          const res = await fetch('/api/beef-cache', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fundingParentTxids }),
          });
          const elapsedMs = Math.round(
            (typeof performance !== 'undefined' ? performance.now() : Date.now()) -
              tFundingParentPrefetch0
          );
          if (!res.ok) {
            console.warn('[mint-beef] funding parent prefetch failed', {
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
            (typeof performance !== 'undefined' ? performance.now() : Date.now()) -
              tFundingParentPrefetch0
          );
          console.warn('[mint-beef] funding parent prefetch threw', {
            error,
            elapsedMs,
          });
          return { parents: [], skipped: [], elapsedMs };
        }
      })();

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
      return;
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
        rawtxChars: rawtx.length,
        selectedMinterTxid: selectedMinter.txid,
        prefetchedFundingParentCount: prefetchedFundingParents.parents.length,
        overlayMinterBeefPrefetchMs: overlayMinterBeefPrefetch.elapsedMs,
        overlayMinterBeefPrefetched: overlayMinterBeefPrefetch.prefetched,
        overlayMinterBeefPrefetchSource: overlayMinterBeefPrefetch.source,
        overlayMinterBeefBase64Chars: overlayMinterBeefPrefetch.beefBase64Chars ?? 0,
        timing: mintTiming(undefined, { mark: false }),
      });
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
        }),
      });
      const tBeefSubmit1 = typeof performance !== 'undefined' ? performance.now() : Date.now();

      if (!res.ok) {
        const errorData = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        console.warn('[mint-beef] beef-cache build+submit failed', {
          status: res.status,
          statusText: res.statusText,
          ms: Math.round(tBeefSubmit1 - tBeefSubmit0),
          response: errorData,
        });
        const broadcastError =
          typeof (errorData.overlay as { message?: unknown } | undefined)?.message === 'string'
              ? ((errorData.overlay as { message: string }).message)
            : typeof (errorData.overlay as { error?: unknown } | undefined)?.error === 'string'
              ? ((errorData.overlay as { error: string }).error)
            : typeof errorData.error === 'string'
              ? errorData.error
              : undefined;
        throw new Error(
          broadcastError ?? `Overlay submit failed: ${res.status} ${res.statusText}`
        );
      }

      const data = (await res.json()) as {
        txid?: string
        overlay?: unknown
        topics?: string[]
        timings?: {
          buildBeefMs?: number
          overlaySubmitMs?: number
        }
      };
      txid = typeof data.txid === 'string' ? data.txid : '';

      console.log('[mint-beef] beef-cache build+submit ok', {
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

      setProgress(80);
      keepFundingReservations = true;
      keepContractReservation = true;
      const balanceRefresh = walletContext.fetchDetailedBalance?.();
      if (balanceRefresh) {
        void balanceRefresh.catch((balanceError: unknown) => {
          console.warn('mint - failed to refresh wallet balance after broadcast', balanceError);
        });
      }

      const submitLikeResponse = await fetch('/api/likes/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          txid,
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

      const submitLikeBody = (await submitLikeResponse.json().catch(() => ({}))) as {
        like?: { txid: string } & Record<string, unknown>;
        error?: string;
      };

      if (!submitLikeResponse.ok || !submitLikeBody.like) {
        throw new Error(
          submitLikeBody.error ||
            `Failed to persist like: ${submitLikeResponse.status} ${submitLikeResponse.statusText}`
        );
      }

      newLikeData = submitLikeBody.like;
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

    queryClient.setQueryData(['posts'], (oldData: { pages: PostType[][] } | undefined) => {
      if (!oldData?.pages) return oldData;
      return {
        ...oldData,
        pages: oldData.pages.map((page: PostType[]) =>
          page.map((p: PostType) => {
            if (p.txid === post.txid) {
              return {
                ...p,
                likes: [newLikeData, ...(p.likes || [])],
              };
            }
            return p;
          })
        ),
      };
    });

    queryClient.invalidateQueries({ queryKey: ['posts', post.txid] });

    setProgress(100);
    toast({ title: 'Success!', description: 'Like locked successfully!', duration: 2000 });
    console.log('[mint-beef] mint complete', {
      txid,
      timing: mintTiming(),
    });

    setTimeout(() => {
      setIsLockSheetOpen(false);
      setProgress(0);
    }, 500);
  } catch (error: any) {
    console.error('Error locking like:', error);
    setProgress(0);
    toast({
      variant: 'destructive',
      title: 'Error Locking Like',
      description: error?.message || error?.toString() || 'Failed to lock like. Please try again.',
      duration: 5000,
    });
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


