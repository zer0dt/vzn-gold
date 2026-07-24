import { MINT_FUNDING_INPUT_HEADROOM_SATS } from '@/app/lib/mint-funding';

const LOG_PREFIX = '[mint-prefetch]';
const PENDING_MINT_FUNDING_UTXOS_KEY = 'pendingMintFundingOutpoints';
const PENDING_MINT_CONTRACT_UTXOS_KEY = 'pendingMintContractOutpoints';
const PENDING_MINT_FUNDING_TTL_MS = 2 * 60 * 1000;
const CLIENT_MINTER_CACHE_TTL_MS = 45_000;
const CLIENT_PARENT_BEEF_CACHE_TTL_MS = 60_000;
const CLIENT_FUNDING_CACHE_TTL_MS = 45_000;

type PendingMintReservation = {
  key: string;
  reservedAt: number;
};

export type OverlayMinterResponse = {
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

export type PaymentUtxo = {
  txId: string;
  outputIndex: number;
  satoshis: number;
  script: string;
  confirmed?: boolean;
  height?: number | null;
  confirmations?: number | null;
};

export type PreparedFundingParent = {
  txid: string;
  rawtx: string;
  merklePathHex: string | null;
};

export type FundingParentPrefetchResponse = {
  parents: PreparedFundingParent[];
  skipped?: Array<{ txid: string; reason: string }>;
  elapsedMs?: number;
};

export type AvailablePaymentUtxo = {
  satoshis: number;
  txid: string;
  vout: number;
  confirmed: boolean;
  height: number | null;
  confirmations: number | null;
};

export type FundingUtxoPrefetchResult =
  | { utxos: AvailablePaymentUtxo[]; error?: never }
  | { utxos?: never; error: unknown };

type OverlayMinterEntry = {
  key: string;
  originId: string;
  excludeKeys: string[];
  startedAt: number;
  completedAt?: number;
  promise: Promise<OverlayMinterResponse>;
  result?: OverlayMinterResponse;
  error?: unknown;
};

export type PrefetchedOverlayMinter = {
  data: OverlayMinterResponse;
  ageMs: number;
  waitMs: number;
};

export type OverlayMinterBeefPrefetch = {
  prefetched: boolean;
  elapsedMs: number;
  source?: string;
  beefBase64Chars?: number;
  fromPrefetch: boolean;
  ageMs: number;
};

type OverlayMinterBeefEntry = {
  key: string;
  originId: string;
  txid: string;
  startedAt: number;
  completedAt?: number;
  promise: Promise<OverlayMinterBeefPrefetch>;
  result?: OverlayMinterBeefPrefetch;
  error?: unknown;
};

type EarlyFundingParentPrefetch = {
  outpointKeys: string[];
  fundingParentTxids: string[];
  prefetchPromise: Promise<FundingParentPrefetchResponse>;
};

type FundingPrefetchEntry = {
  key: string;
  fundingAddress: string;
  satsToLock: number;
  excludedKeys: string[];
  startedAt: number;
  availableFundingUtxosPromise: Promise<FundingUtxoPrefetchResult>;
  earlyFundingParentPrefetchPromise: Promise<EarlyFundingParentPrefetch | null>;
};

export type PrefetchedFundingState = {
  availableFundingUtxosPromise: Promise<FundingUtxoPrefetchResult>;
  earlyFundingParentPrefetchPromise: Promise<EarlyFundingParentPrefetch | null>;
  ageMs: number;
};

type StartLockMintPrefetchParams = {
  originId?: string | null;
  fundingAddress?: string | null;
  contractSats?: number | null;
};

type TakePrefetchedOverlayMinterParams = {
  originId: string;
  excludeKeys: string[];
};

type FundingPrefetchParams = {
  fundingAddress: string;
  satsToLock: number;
  excludeKeys: string[];
};

let llmArtifactLoadPromise: Promise<unknown> | null = null;
const overlayMinterEntries = new Map<string, OverlayMinterEntry>();
const overlayMinterBeefEntries = new Map<string, OverlayMinterBeefEntry>();
const fundingEntries = new Map<string, FundingPrefetchEntry>();

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function wallNowMs(): number {
  return Date.now();
}

function toOutpointKey(txid: string, outputIndex: number): string {
  return `${txid}:${outputIndex}`;
}

function sortedUnique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean))).sort();
}

function excludeFingerprint(excludeKeys: string[]): string {
  return sortedUnique(excludeKeys).join(',');
}

function overlayMinterKey(originId: string, excludeKeys: string[]): string {
  return `${originId}|${excludeFingerprint(excludeKeys)}`;
}

function overlayMinterBeefKey(originId: string, txid: string): string {
  return `${originId}|${txid}`;
}

function fundingKey({ fundingAddress, satsToLock, excludeKeys }: FundingPrefetchParams): string {
  return `${fundingAddress}|${satsToLock}|${excludeFingerprint(excludeKeys)}`;
}

function readPendingReservations(storageKey: string): PendingMintReservation[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw) as PendingMintReservation[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePendingReservations(storageKey: string, reservations: PendingMintReservation[]): void {
  if (typeof window === 'undefined') {
    return;
  }

  if (reservations.length === 0) {
    window.sessionStorage.removeItem(storageKey);
    return;
  }

  window.sessionStorage.setItem(storageKey, JSON.stringify(reservations));
}

function prunePendingReservations(storageKey: string): PendingMintReservation[] {
  const now = wallNowMs();
  const reservations = readPendingReservations(storageKey).filter((reservation) => {
    return now - reservation.reservedAt < PENDING_MINT_FUNDING_TTL_MS;
  });

  writePendingReservations(storageKey, reservations);
  return reservations;
}

function getPendingContractOutpointKeys(): string[] {
  return prunePendingReservations(PENDING_MINT_CONTRACT_UTXOS_KEY).map((reservation) => reservation.key);
}

function getPendingFundingOutpointKeys(): string[] {
  return prunePendingReservations(PENDING_MINT_FUNDING_UTXOS_KEY).map((reservation) => reservation.key);
}

function isOverlayMinterResponse(data: OverlayMinterResponse | undefined): data is OverlayMinterResponse {
  return Boolean(
    data?.txid &&
      data.outputIndex !== undefined &&
      data.rawtx &&
      data.satoshis !== undefined &&
      data.script
  );
}

function isEntryFresh(startedAt: number, ttlMs: number): boolean {
  return wallNowMs() - startedAt < ttlMs;
}

function pruneOverlayMinterEntries(): void {
  for (const [key, entry] of overlayMinterEntries) {
    if (!isEntryFresh(entry.startedAt, CLIENT_MINTER_CACHE_TTL_MS)) {
      overlayMinterEntries.delete(key);
    }
  }
}

function pruneOverlayMinterBeefEntries(): void {
  for (const [key, entry] of overlayMinterBeefEntries) {
    if (!isEntryFresh(entry.startedAt, CLIENT_PARENT_BEEF_CACHE_TTL_MS)) {
      overlayMinterBeefEntries.delete(key);
    }
  }
}

function pruneFundingEntries(): void {
  for (const [key, entry] of fundingEntries) {
    if (!isEntryFresh(entry.startedAt, CLIENT_FUNDING_CACHE_TTL_MS)) {
      fundingEntries.delete(key);
    }
  }
}

async function fetchOverlayMinter(originId: string, excludeKeys: string[]): Promise<OverlayMinterResponse> {
  const excluded = sortedUnique(excludeKeys)
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
  if (!isOverlayMinterResponse(data)) {
    throw new Error('Overlay minter response is incomplete');
  }

  return data;
}

function startOverlayMinterPrefetch(originId: string, excludeKeys: string[]): Promise<OverlayMinterResponse> {
  pruneOverlayMinterEntries();
  const key = overlayMinterKey(originId, excludeKeys);
  const existing = overlayMinterEntries.get(key);
  if (existing) {
    console.log(LOG_PREFIX, 'overlay minter dedupe', {
      originId,
      excludeCount: existing.excludeKeys.length,
      ageMs: wallNowMs() - existing.startedAt,
    });
    return existing.promise;
  }

  const startedAt = wallNowMs();
  console.log(LOG_PREFIX, 'overlay minter start', {
    originId,
    excludeCount: excludeKeys.length,
  });

  const promise = fetchOverlayMinter(originId, excludeKeys)
    .then((data) => {
      const entry = overlayMinterEntries.get(key);
      if (entry) {
        entry.result = data;
        entry.completedAt = wallNowMs();
      }
      console.log(LOG_PREFIX, 'overlay minter ready', {
        originId,
        txid: data.txid,
        outputIndex: data.outputIndex,
        candidateCount: data.candidateCount,
        elapsedMs: wallNowMs() - startedAt,
      });
      void startOverlayMinterBeefPrefetch({ originId, txid: data.txid, fromSheetPrefetch: true });
      return data;
    })
    .catch((error) => {
      const entry = overlayMinterEntries.get(key);
      if (entry) {
        entry.error = error;
        entry.completedAt = wallNowMs();
      }
      console.warn(LOG_PREFIX, 'overlay minter failed', {
        originId,
        elapsedMs: wallNowMs() - startedAt,
        error,
      });
      throw error;
    });

  overlayMinterEntries.set(key, {
    key,
    originId,
    excludeKeys: sortedUnique(excludeKeys),
    startedAt,
    promise,
  });
  return promise;
}

export async function takePrefetchedOverlayMinter({
  originId,
  excludeKeys,
}: TakePrefetchedOverlayMinterParams): Promise<PrefetchedOverlayMinter | null> {
  pruneOverlayMinterEntries();
  const key = overlayMinterKey(originId, excludeKeys);
  const entry = overlayMinterEntries.get(key);

  if (!entry) {
    for (const [entryKey, possibleEntry] of overlayMinterEntries) {
      if (possibleEntry.originId !== originId || !possibleEntry.result) {
        continue;
      }

      const outpointKey = toOutpointKey(possibleEntry.result.txid, possibleEntry.result.outputIndex);
      if (excludeKeys.includes(outpointKey)) {
        overlayMinterEntries.delete(entryKey);
        console.log(LOG_PREFIX, 'overlay minter exclude-invalidate', {
          originId,
          txid: possibleEntry.result.txid,
          outputIndex: possibleEntry.result.outputIndex,
        });
      }
    }

    console.log(LOG_PREFIX, 'overlay minter miss', { originId, excludeCount: excludeKeys.length });
    return null;
  }

  const waitedFrom = nowMs();
  try {
    const data = entry.result ?? (await entry.promise);
    const waitMs = Math.round(nowMs() - waitedFrom);
    const outpointKey = toOutpointKey(data.txid, data.outputIndex);
    if (excludeKeys.includes(outpointKey)) {
      overlayMinterEntries.delete(key);
      console.log(LOG_PREFIX, 'overlay minter stale-excluded', {
        originId,
        txid: data.txid,
        outputIndex: data.outputIndex,
        waitMs,
      });
      return null;
    }

    overlayMinterEntries.delete(key);
    const ageMs = wallNowMs() - entry.startedAt;
    console.log(LOG_PREFIX, 'overlay minter hit', {
      originId,
      txid: data.txid,
      outputIndex: data.outputIndex,
      ageMs,
      waitMs,
    });
    return { data, ageMs, waitMs };
  } catch (error) {
    overlayMinterEntries.delete(key);
    console.warn(LOG_PREFIX, 'overlay minter take failed', { originId, error });
    return null;
  }
}

export function startOverlayMinterBeefPrefetch({
  originId,
  txid,
  fromSheetPrefetch = false,
}: {
  originId: string;
  txid: string;
  fromSheetPrefetch?: boolean;
}): Promise<OverlayMinterBeefPrefetch> {
  pruneOverlayMinterBeefEntries();
  const key = overlayMinterBeefKey(originId, txid);
  const existing = overlayMinterBeefEntries.get(key);
  if (existing) {
    console.log(LOG_PREFIX, 'overlay minter BEEF dedupe', {
      originId,
      txid,
      ageMs: wallNowMs() - existing.startedAt,
    });
    return existing.promise.then((result) => ({
      ...result,
      fromPrefetch: true,
      ageMs: wallNowMs() - existing.startedAt,
    }));
  }

  const startedAt = wallNowMs();
  console.log(LOG_PREFIX, 'overlay minter BEEF start', {
    originId,
    txid,
    fromSheetPrefetch,
  });

  const promise = (async (): Promise<OverlayMinterBeefPrefetch> => {
    try {
      const res = await fetch(
        `/api/overlay/parent-beef?originId=${encodeURIComponent(originId)}&txid=${encodeURIComponent(txid)}`,
        { cache: 'no-store' }
      );
      const elapsedMs = wallNowMs() - startedAt;
      if (!res.ok) {
        console.warn(LOG_PREFIX, 'overlay minter BEEF failed', {
          originId,
          txid,
          status: res.status,
          statusText: res.statusText,
          elapsedMs,
        });
        return { prefetched: false, elapsedMs, fromPrefetch: false, ageMs: elapsedMs };
      }

      const body = (await res.json()) as {
        prefetched?: boolean;
        elapsedMs?: number;
        source?: string;
        beefBase64Chars?: number;
      };
      return {
        prefetched: Boolean(body.prefetched),
        elapsedMs: body.elapsedMs ?? elapsedMs,
        source: body.source,
        beefBase64Chars: body.beefBase64Chars,
        fromPrefetch: false,
        ageMs: elapsedMs,
      };
    } catch (error) {
      const elapsedMs = wallNowMs() - startedAt;
      console.warn(LOG_PREFIX, 'overlay minter BEEF threw', { originId, txid, error, elapsedMs });
      return { prefetched: false, elapsedMs, fromPrefetch: false, ageMs: elapsedMs };
    }
  })()
    .then((result) => {
      const entry = overlayMinterBeefEntries.get(key);
      if (entry) {
        entry.result = result;
        entry.completedAt = wallNowMs();
      }
      console.log(LOG_PREFIX, 'overlay minter BEEF ready', {
        originId,
        txid,
        prefetched: result.prefetched,
        source: result.source,
        elapsedMs: result.elapsedMs,
      });
      return result;
    })
    .catch((error) => {
      const entry = overlayMinterBeefEntries.get(key);
      if (entry) {
        entry.error = error;
        entry.completedAt = wallNowMs();
      }
      throw error;
    });

  overlayMinterBeefEntries.set(key, {
    key,
    originId,
    txid,
    startedAt,
    promise,
  });
  return promise;
}

function startFundingParentPrefetch(
  fundingParentTxids: string[],
  phase: 'sheet' | 'early' | 'exact'
): Promise<FundingParentPrefetchResponse> {
  const startedAt = wallNowMs();
  console.log(LOG_PREFIX, 'funding parent start', { phase, fundingParentTxids });

  return (async () => {
    try {
      const res = await fetch('/api/beef-cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fundingParentTxids }),
      });
      const elapsedMs = wallNowMs() - startedAt;
      if (!res.ok) {
        console.warn(LOG_PREFIX, 'funding parent failed', {
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
      const elapsedMs = wallNowMs() - startedAt;
      console.warn(LOG_PREFIX, 'funding parent threw', { phase, error, elapsedMs });
      return { parents: [], skipped: [], elapsedMs };
    }
  })();
}

function startFundingPrefetch(params: FundingPrefetchParams): PrefetchedFundingState {
  pruneFundingEntries();
  const key = fundingKey(params);
  const existing = fundingEntries.get(key);
  if (existing) {
    console.log(LOG_PREFIX, 'funding dedupe', {
      fundingAddress: params.fundingAddress,
      satsToLock: params.satsToLock,
      ageMs: wallNowMs() - existing.startedAt,
    });
    return {
      availableFundingUtxosPromise: existing.availableFundingUtxosPromise,
      earlyFundingParentPrefetchPromise: existing.earlyFundingParentPrefetchPromise,
      ageMs: wallNowMs() - existing.startedAt,
    };
  }

  const startedAt = wallNowMs();
  console.log(LOG_PREFIX, 'funding start', {
    fundingAddress: params.fundingAddress,
    satsToLock: params.satsToLock,
    excludeCount: params.excludeKeys.length,
  });

  const walletPaymentModulePromise = import('@/app/lib/wallet-payment');
  const availableFundingUtxosPromise: Promise<FundingUtxoPrefetchResult> = walletPaymentModulePromise
    .then(({ fetchAvailablePaymentUTXOs }) =>
      (fetchAvailablePaymentUTXOs(params.fundingAddress) as Promise<AvailablePaymentUtxo[]>).then((utxos) => ({
        utxos,
      }))
    )
    .catch((error) => ({ error }));

  const earlyFundingParentPrefetchPromise = Promise.all([
    walletPaymentModulePromise,
    availableFundingUtxosPromise,
  ])
    .then(([{ selectPaymentUTXOs }, availableResult]) => {
      if ('error' in availableResult) {
        console.warn(LOG_PREFIX, 'funding UTXO fetch failed', {
          fundingAddress: params.fundingAddress,
          error: availableResult.error,
        });
        return null;
      }

      const preliminaryRequiredSatoshis = Math.max(
        1,
        params.satsToLock + MINT_FUNDING_INPUT_HEADROOM_SATS
      );
      const preliminaryUtxos = selectPaymentUTXOs(
        params.fundingAddress,
        preliminaryRequiredSatoshis,
        availableResult.utxos,
        params.excludeKeys
      ) as PaymentUtxo[];
      if (preliminaryUtxos.length === 0) {
        console.log(LOG_PREFIX, 'funding no preliminary UTXOs', {
          fundingAddress: params.fundingAddress,
          preliminaryRequiredSatoshis,
        });
        return null;
      }

      const outpointKeys = preliminaryUtxos.map((utxo) => toOutpointKey(utxo.txId, utxo.outputIndex));
      const fundingParentTxids = Array.from(
        new Set(preliminaryUtxos.map((utxo) => utxo.txId).filter(Boolean))
      );
      return {
        outpointKeys,
        fundingParentTxids,
        prefetchPromise: startFundingParentPrefetch(fundingParentTxids, 'sheet'),
      };
    })
    .then((result) => {
      console.log(LOG_PREFIX, 'funding ready', {
        fundingAddress: params.fundingAddress,
        satsToLock: params.satsToLock,
        hasEarlyParents: Boolean(result),
        elapsedMs: wallNowMs() - startedAt,
      });
      return result;
    })
    .catch((error) => {
      console.warn(LOG_PREFIX, 'funding failed', {
        fundingAddress: params.fundingAddress,
        satsToLock: params.satsToLock,
        error,
      });
      return null;
    });

  fundingEntries.set(key, {
    key,
    fundingAddress: params.fundingAddress,
    satsToLock: params.satsToLock,
    excludedKeys: sortedUnique(params.excludeKeys),
    startedAt,
    availableFundingUtxosPromise,
    earlyFundingParentPrefetchPromise,
  });

  return {
    availableFundingUtxosPromise,
    earlyFundingParentPrefetchPromise,
    ageMs: 0,
  };
}

export function getPrefetchedFundingState(params: FundingPrefetchParams): PrefetchedFundingState | null {
  pruneFundingEntries();
  const entry = fundingEntries.get(fundingKey(params));
  if (!entry) {
    console.log(LOG_PREFIX, 'funding miss', {
      fundingAddress: params.fundingAddress,
      satsToLock: params.satsToLock,
      excludeCount: params.excludeKeys.length,
    });
    return null;
  }

  const ageMs = wallNowMs() - entry.startedAt;
  console.log(LOG_PREFIX, 'funding hit', {
    fundingAddress: params.fundingAddress,
    satsToLock: params.satsToLock,
    ageMs,
  });
  return {
    availableFundingUtxosPromise: entry.availableFundingUtxosPromise,
    earlyFundingParentPrefetchPromise: entry.earlyFundingParentPrefetchPromise,
    ageMs,
  };
}

export function startLockMintPrefetch({
  originId,
  fundingAddress,
  contractSats,
}: StartLockMintPrefetchParams): void {
  const normalizedOriginId = originId?.trim();
  if (normalizedOriginId) {
    void startOverlayMinterPrefetch(normalizedOriginId, getPendingContractOutpointKeys()).catch(() => {});
  }

  if (fundingAddress && typeof contractSats === 'number' && contractSats > 0) {
    startFundingPrefetch({
      fundingAddress,
      satsToLock: contractSats,
      excludeKeys: getPendingFundingOutpointKeys(),
    });
  }
}

export function ensureLlmArtifactPrefetch(): Promise<unknown> {
  if (!llmArtifactLoadPromise) {
    llmArtifactLoadPromise = Promise.all([
      import('@/src/contracts/LockLikeMintBSV21Parallel'),
      import('@/artifacts/LockLikeMintBSV21Parallel.json'),
    ]).then(([contractModule, artifactModule]) => {
      const contract = contractModule.LockLikeMintBSV21Parallel;
      const artifact = 'default' in artifactModule ? artifactModule.default : artifactModule;
      return contract.loadArtifact(artifact as any);
    });
  }

  return llmArtifactLoadPromise;
}
