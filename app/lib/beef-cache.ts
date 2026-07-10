import { Beef, MerklePath, Transaction } from '@bsv/sdk'

import { isBsv21MinterPoolOp } from '@/app/lib/bsv21-minter-pool'
import { normalizeOverlayBaseUrl, overlayUpstreamHeaders } from '@/app/lib/overlay-url'
import { fetchWhatsOnChain, wocFetchJson, wocFetchText } from '@/app/lib/woc-retry-fetch'

const WOC_BASE_URL = 'https://api.whatsonchain.com/v1/bsv/main'
const OVERLAY_URL = process.env.OVERLAY_URL ?? 'http://localhost:3001'

type TscProof = {
  txOrId: string
  target: string
  index: number
  nodes: string[]
}

type BlockHeader = {
  height: number
  merkleroot: string
}

type LatestContractTipRawTx = {
  txid: string
  outputIndex: number
  rawtx: string
}

type OverlayBsv21Parent = {
  originId: string
  txid: string
}

type BuildCachedBeefOptions = {
  knownTxids?: string[]
  overlayBsv21Parent?: OverlayBsv21Parent
  /** Base64 BEEF from overlay `?beef=true` when already fetched (e.g. client prefetch). Skips server overlay HTTP when valid. */
  overlayParentBeefBase64?: string
  fundingParents?: PreparedFundingParent[]
}

export type BuildCachedBeefTimings = {
  parseRawTxMs: number
  overlayParentBeefFetchMs?: number
  overlayParentBeefSource: 'client-body' | 'cache' | 'overlay' | 'none'
  hydrateMs: number
  serializeBeefMs: number
  elapsedMs: number
  overlaySeededInputTxidCount: number
  hydratedInputTxidCount: number
  preparedFundingParentCount: number
}

type OverlayTransactionResponse = {
  beef?: string
}

type OverlayUnspentOutput = {
  txid?: string
  vout?: number
  outputIndex?: number
  outpoint?: string
  data?: {
    bsv21?: {
      address?: string
      amt?: string
      op?: string
      id?: string
    }
  }
}

export type PreparedFundingParent = {
  txid: string
  rawtx: string
  merklePathHex: string | null
}

function isValidTxid(txid: string): boolean {
  return /^[0-9a-f]{64}$/i.test(txid)
}

function overlayOutpoint(output: OverlayUnspentOutput): { txid: string; outputIndex: number } | null {
  if (output.txid && typeof output.vout === 'number') {
    return { txid: output.txid, outputIndex: output.vout }
  }

  if (output.txid && typeof output.outputIndex === 'number') {
    return { txid: output.txid, outputIndex: output.outputIndex }
  }

  if (output.outpoint) {
    const separator = output.outpoint.includes('_') ? '_' : '.'
    const [txid, outputIndexText] = output.outpoint.split(separator)
    const outputIndex = Number(outputIndexText)
    if (txid && Number.isInteger(outputIndex) && outputIndex >= 0) {
      return { txid, outputIndex }
    }
  }

  return null
}

function parseBsv21Amount(output: OverlayUnspentOutput): bigint {
  const amt = output.data?.bsv21?.amt
  return amt !== undefined && /^[0-9]+$/.test(amt) ? BigInt(amt) : BigInt(0)
}

function isOverlayMinterOutput(output: OverlayUnspentOutput, originId: string): boolean {
  const outpoint = overlayOutpoint(output)
  const bsv21 = output.data?.bsv21
  if (!bsv21) return false

  return (
    outpoint !== null &&
    (outpoint.outputIndex === 0 || outpoint.outputIndex === 1) &&
    isBsv21MinterPoolOp(bsv21.op) &&
    bsv21.id === originId &&
    typeof bsv21.amt === 'string' &&
    /^[0-9]+$/.test(bsv21.amt) &&
    !bsv21.address
  )
}

const HOT_RAWTX_CACHE_TTL_MS = 15_000
const hotRawTransactionCache = new Map<string, { rawtx: string; expiresAt: number }>()
const OVERLAY_PARENT_BEEF_CACHE_TTL_MS = 60_000
const overlayParentBeefCache = new Map<string, { beefBase64: string; expiresAt: number }>()

function buildBeefV2(tx: Transaction): Beef {
  const beef = new Beef()
  beef.mergeTransaction(tx)
  return beef
}

function transactionToHexAtomicBeefWithFullAncestors(tx: Transaction): string {
	const beef = buildBeefV2(tx)
  const tipTxid = tx.id('hex')
  return Buffer.from(beef.toBinaryAtomic(tipTxid)).toString('hex')
}

function transactionToHexAtomicBeef(tx: Transaction, seedBeef?: Beef): string {
  const beef = seedBeef ?? buildBeefV2(tx)
  if (seedBeef) {
    beef.mergeTransaction(tx)
  }

  const tipTxid = tx.id('hex')
  const atomicTx = beef.findAtomicTransaction(tipTxid)
  if (!atomicTx) {
    throw new Error(`Unable to build atomic BEEF for ${tipTxid}`)
  }

  return Buffer.from(beef.toBinaryAtomic(tipTxid)).toString('hex')
}

/** Overlay and other non-WOC JSON helpers (no WOC retry layer). */
async function fetchJson<T>(url: string, headers?: Record<string, string>): Promise<T> {
  const response = await fetch(url, {
    cache: 'no-store',
    ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
  })
  const body = await response.text()

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}): ${body || response.statusText}`)
  }

  return JSON.parse(body) as T
}

function overlayParentBeefCacheKey(parent: OverlayBsv21Parent): string {
  return `${parent.originId}:${parent.txid}`
}

function readCachedOverlayParentBeefBase64(parent: OverlayBsv21Parent): string | null {
  const entry = overlayParentBeefCache.get(overlayParentBeefCacheKey(parent))
  if (!entry) {
    return null
  }

  if (entry.expiresAt <= Date.now()) {
    overlayParentBeefCache.delete(overlayParentBeefCacheKey(parent))
    return null
  }

  return entry.beefBase64
}

function writeCachedOverlayParentBeefBase64(parent: OverlayBsv21Parent, beefBase64: string): void {
  overlayParentBeefCache.set(overlayParentBeefCacheKey(parent), {
    beefBase64,
    expiresAt: Date.now() + OVERLAY_PARENT_BEEF_CACHE_TTL_MS,
  })
}

export async function prefetchOverlayBsv21ParentBeefBase64(parent: OverlayBsv21Parent): Promise<{
  beefBase64: string | null
  elapsedMs: number
  source: 'cache' | 'overlay' | 'none'
}> {
  const startedAt = Date.now()
  if (!parent.originId.trim() || !isValidTxid(parent.txid)) {
    console.log('[beef-cache] overlay parent BEEF prefetch skipped', {
      reason: 'invalid_origin_or_txid',
      elapsedMs: Date.now() - startedAt,
      originId: parent.originId,
      txid: parent.txid,
    })
    return { beefBase64: null, elapsedMs: Date.now() - startedAt, source: 'none' }
  }

  const cached = readCachedOverlayParentBeefBase64(parent)
  if (cached) {
    const elapsedMs = Date.now() - startedAt
    console.log('[beef-cache] overlay parent BEEF prefetch cache hit', {
      originId: parent.originId,
      txid: parent.txid,
      elapsedMs,
      beefBase64Chars: cached.length,
    })
    return { beefBase64: cached, elapsedMs, source: 'cache' }
  }

  try {
    const url = `${normalizeOverlayBaseUrl(OVERLAY_URL)}/api/1sat/bsv21/${encodeURIComponent(
      parent.originId
    )}/tx/${encodeURIComponent(parent.txid)}?beef=true`

    const response = await fetchJson<OverlayTransactionResponse>(
      url,
      overlayUpstreamHeaders(OVERLAY_URL)
    )
    const elapsedMs = Date.now() - startedAt
    if (!response.beef || typeof response.beef !== 'string') {
      console.warn('[beef-cache] overlay parent BEEF prefetch unavailable (no beef in response)', {
        originId: parent.originId,
        txid: parent.txid,
        elapsedMs,
      })
      return { beefBase64: null, elapsedMs, source: 'none' }
    }

    const beefBase64 = response.beef.trim()
    writeCachedOverlayParentBeefBase64(parent, beefBase64)
    console.log('[beef-cache] overlay parent BEEF prefetched', {
      originId: parent.originId,
      txid: parent.txid,
      elapsedMs,
      beefBase64Chars: beefBase64.length,
    })
    return { beefBase64, elapsedMs, source: 'overlay' }
  } catch (error) {
    const elapsedMs = Date.now() - startedAt
    console.warn('[beef-cache] overlay parent BEEF prefetch threw', {
      originId: parent.originId,
      txid: parent.txid,
      elapsedMs,
      error: error instanceof Error ? error.message : String(error),
    })
    return { beefBase64: null, elapsedMs, source: 'none' }
  }
}

async function fetchOverlayBsv21ParentBeef(parent: OverlayBsv21Parent): Promise<{
  beef: Beef | null
  elapsedMs: number
  source: 'cache' | 'overlay' | 'none'
}> {
  const startedAt = Date.now()
  if (!parent.originId.trim() || !isValidTxid(parent.txid)) {
    console.log('[beef-cache] overlay parent BEEF skipped', {
      reason: 'invalid_origin_or_txid',
      elapsedMs: Date.now() - startedAt,
      originId: parent.originId,
      txid: parent.txid,
    })
    return { beef: null, elapsedMs: Date.now() - startedAt, source: 'none' }
  }

  try {
    const result = await prefetchOverlayBsv21ParentBeefBase64(parent)
    if (!result.beefBase64) {
      return { beef: null, elapsedMs: Date.now() - startedAt, source: 'none' }
    }

    const beef = Beef.fromBinary(Array.from(Buffer.from(result.beefBase64, 'base64')))
    const elapsedMs = Date.now() - startedAt
    console.log('[beef-cache] overlay parent BEEF fetched', {
      originId: parent.originId,
      txid: parent.txid,
      elapsedMs,
      source: result.source,
      beefBase64Chars: result.beefBase64.length,
    })
    return { beef, elapsedMs, source: result.source }
  } catch (error) {
    const elapsedMs = Date.now() - startedAt
    console.warn('[beef-cache] overlay parent BEEF unavailable; falling back to hydration', {
      originId: parent.originId,
      txid: parent.txid,
      elapsedMs,
      error: error instanceof Error ? error.message : String(error),
    })
    return { beef: null, elapsedMs, source: 'none' }
  }
}

async function fetchLatestOverlayMinterOutpoint(originId: string): Promise<{ txid: string; outputIndex: number }> {
  const topic = `tm_${originId}`
  const event = `id:${originId}`
  const response = await fetch(
    `${normalizeOverlayBaseUrl(OVERLAY_URL)}/api/1sat/events/${topic}/unspent?limit=1000`,
    {
      method: 'POST',
      headers: overlayUpstreamHeaders(OVERLAY_URL, { 'Content-Type': 'application/json' }),
      body: JSON.stringify([event]),
      cache: 'no-store',
    }
  )
  const payload = (await response.json()) as unknown

  if (!response.ok) {
    throw new Error(`Overlay minter lookup failed (${response.status})`)
  }

  if (!Array.isArray(payload)) {
    throw new Error('Overlay minter lookup returned an unexpected response')
  }

  const [latestMinter] = payload
    .map((output) => output as OverlayUnspentOutput)
    .filter((output) => isOverlayMinterOutput(output, originId))
    .map((output) => {
      const outpoint = overlayOutpoint(output)
      return outpoint ? { ...outpoint, amount: parseBsv21Amount(output) } : null
    })
    .filter((candidate): candidate is { txid: string; outputIndex: number; amount: bigint } => {
      return candidate !== null
    })
    .sort((a, b) => {
      if (a.amount === b.amount) return 0
      return a.amount > b.amount ? -1 : 1
    })

  if (!latestMinter) {
    throw new Error('Overlay returned no live BSV21 minter outpoints')
  }

  return {
    txid: latestMinter.txid,
    outputIndex: latestMinter.outputIndex,
  }
}

function convertTSCtoBUMP(tsc: TscProof, header: BlockHeader): MerklePath {
  const txid = tsc.txOrId
  const bump: {
    blockHeight: number
    path: Array<Array<{ offset: number; hash?: string; txid?: boolean; duplicate?: boolean }>>
  } = {
    blockHeight: header.height,
    path: [],
  }

  const leafOfInterest = { hash: txid, txid: true, offset: tsc.index }

  tsc.nodes.forEach((hash, idx) => {
    const offset = (tsc.index >> idx) ^ 1
    const leaf: { offset: number; hash?: string; duplicate?: boolean } = { offset }

    if (hash === '*') {
      leaf.duplicate = true
    } else {
      leaf.hash = hash
    }

    if (idx === 0) {
      bump.path.push(tsc.index % 2 ? [leafOfInterest, leaf] : [leaf, leafOfInterest])
      return
    }

    bump.path.push([leaf])
  })

  const merklePath = new MerklePath(bump.blockHeight, bump.path)
  if (header.merkleroot !== merklePath.computeRoot(txid)) {
    throw new Error('Invalid merkle path returned from WhatsOnChain')
  }

  return merklePath
}

async function fetchMerklePathHex(txid: string): Promise<{ merklePathHex: string; confirmedHeight: number } | null> {
  const proofResponse = await fetchWhatsOnChain(`${WOC_BASE_URL}/tx/${txid}/proof/tsc`)
  if (!proofResponse.ok) {
    return null
  }

  const proofText = await proofResponse.text()
  if (!proofText.trim()) {
    return null
  }

  let parsedProof: TscProof | TscProof[]
  try {
    parsedProof = JSON.parse(proofText) as TscProof | TscProof[]
  } catch {
    return null
  }

  const tsc = Array.isArray(parsedProof) ? parsedProof[0] : parsedProof
  if (!tsc?.target) {
    return null
  }

  const header = await wocFetchJson<BlockHeader>(`${WOC_BASE_URL}/block/${tsc.target}/header`)
  const merklePath = convertTSCtoBUMP(tsc, header)

  return {
    merklePathHex: merklePath.toHex(),
    confirmedHeight: header.height,
  }
}

async function fetchRawTransactionHex(txid: string): Promise<string> {
  try {
    return await wocFetchText(`${WOC_BASE_URL}/tx/${txid}/hex`)
  } catch {
    const response = await fetch(`https://api.bitails.io/tx/${txid}/raw`, { cache: 'no-store' })
    const body = await response.text()
    if (!response.ok) {
      throw new Error(`Request failed (${response.status}): ${body || response.statusText}`)
    }
    return body.trim()
  }
}

function readHotRawTransactionHex(txid: string): string | null {
  const entry = hotRawTransactionCache.get(txid)
  if (!entry) {
    return null
  }

  if (entry.expiresAt <= Date.now()) {
    hotRawTransactionCache.delete(txid)
    return null
  }

  return entry.rawtx
}

function writeHotRawTransactionHex(txid: string, rawtx: string): void {
  hotRawTransactionCache.set(txid, {
    rawtx,
    expiresAt: Date.now() + HOT_RAWTX_CACHE_TTL_MS,
  })
}

async function getRawTransactionHexCached(txid: string): Promise<string> {
  const hotRawtx = readHotRawTransactionHex(txid)
  if (hotRawtx) {
    return hotRawtx
  }

  const rawtx = await fetchRawTransactionHex(txid)
  writeHotRawTransactionHex(txid, rawtx)
  return rawtx
}

export async function getRawTransactionHexForTxid(txid: string): Promise<string> {
  if (!isValidTxid(txid)) {
    throw new Error(`Invalid txid: ${txid}`)
  }

  return getRawTransactionHexCached(txid)
}

export async function getLatestContractTip(originId: string): Promise<{ txid: string; outputIndex: number }> {
  return fetchLatestOverlayMinterOutpoint(originId)
}

async function hydrateTransaction(
  txid: string,
  cache: Map<string, Transaction>,
  preparedParents: Map<string, PreparedFundingParent> = new Map(),
  inFlight: Map<string, Promise<Transaction>> = new Map()
): Promise<Transaction> {
  if (!isValidTxid(txid)) {
    throw new Error(`Invalid txid: ${txid}`)
  }

  const cachedTransaction = cache.get(txid)
  if (cachedTransaction) {
    return cachedTransaction
  }

  const pendingTransaction = inFlight.get(txid)
  if (pendingTransaction) {
    return pendingTransaction
  }

  const hydratePromise = hydrateTransactionUncached(txid, cache, preparedParents, inFlight)
  inFlight.set(txid, hydratePromise)
  try {
    return await hydratePromise
  } finally {
    inFlight.delete(txid)
  }
}

async function hydrateTransactionUncached(
  txid: string,
  cache: Map<string, Transaction>,
  preparedParents: Map<string, PreparedFundingParent>,
  inFlight: Map<string, Promise<Transaction>>
): Promise<Transaction> {
  const preparedParent = preparedParents.get(txid)
  const rawtx = preparedParent?.rawtx ?? await getRawTransactionHexCached(txid)

  if (!rawtx) {
    throw new Error(`Missing raw transaction for ${txid}`)
  }

  const tx = Transaction.fromHex(rawtx)
  cache.set(txid, tx)

  const merklePathHex = preparedParent?.merklePathHex ?? null
  if (merklePathHex) {
    tx.merklePath = MerklePath.fromHex(merklePathHex)
    return tx
  }

  const proof = preparedParent?.merklePathHex === null ? null : await fetchMerklePathHex(txid)
  if (proof) {
    tx.merklePath = MerklePath.fromHex(proof.merklePathHex)
    return tx
  }

  const sourceTxids = tx.inputs
    .map((input) => input.sourceTXID)
    .filter((id): id is string => !!id)
  if (sourceTxids.length !== tx.inputs.length) {
    throw new Error(`Missing sourceTXID while hydrating ${txid}`)
  }
  const hydrated = await Promise.all(
    sourceTxids.map((sourceTxid) => hydrateTransaction(sourceTxid, cache, preparedParents, inFlight))
  )
  tx.inputs.forEach((input, i) => {
    input.sourceTransaction = hydrated[i]
  })

  return tx
}

export async function getCachedBeefByTxid(txid: string): Promise<{ txid: string; beef: string }> {
  const tx = await hydrateTransaction(txid, new Map(), new Map(), new Map())
  return {
    txid,
    beef: transactionToHexAtomicBeefWithFullAncestors(tx),
  }
}

export async function getLatestContractTipBeef(originId: string): Promise<{
  txid: string
  outputIndex: number
  beef: string
}> {
  const { txid, outputIndex } = await getLatestContractTip(originId)
  const tx = await hydrateTransaction(txid, new Map(), new Map(), new Map())

  return {
    txid,
    outputIndex,
    beef: transactionToHexAtomicBeefWithFullAncestors(tx),
  }
}

export async function getLatestContractTipRawTx(originId: string): Promise<LatestContractTipRawTx> {
  const startedAt = Date.now()
  const { txid, outputIndex } = await getLatestContractTip(originId)
  const rawtx = await getRawTransactionHexCached(txid)

  console.log('[beef-cache] latest contract tip rawtx', {
    originId,
    txid,
    outputIndex,
    rawtxLength: rawtx.length,
    elapsedMs: Date.now() - startedAt,
  })

  return {
    txid,
    outputIndex,
    rawtx,
  }
}

export async function prepareFundingParents(txids: string[]): Promise<{
  parents: PreparedFundingParent[]
  skipped: Array<{ txid: string; reason: string }>
}> {
  const uniqueTxids = Array.from(new Set(txids.map((txid) => txid.trim()).filter(isValidTxid)))
  const results = await Promise.all(
    uniqueTxids.map(async (txid) => {
    try {
      const rawtx = await getRawTransactionHexCached(txid)
      const proof = await fetchMerklePathHex(txid)
      return {
        ok: true as const,
        txid,
        rawtx,
        merklePathHex: proof?.merklePathHex ?? null,
      }
    } catch (error) {
      return {
        ok: false as const,
        txid,
        reason: error instanceof Error ? error.message : String(error),
      }
    }
    })
  )

  return {
    parents: results
      .filter((result): result is PreparedFundingParent & { ok: true } => result.ok)
      .map(({ txid, rawtx, merklePathHex }) => ({ txid, rawtx, merklePathHex })),
    skipped: results
      .filter((result): result is { ok: false; txid: string; reason: string } => !result.ok)
      .map(({ txid, reason }) => ({ txid, reason })),
  }
}

export async function buildCachedBeefFromRawTx(
  rawtx: string,
  options: BuildCachedBeefOptions | string[] = {}
): Promise<{ beef: string; timings: BuildCachedBeefTimings }> {
  const startedAt = Date.now()
  const parseRawTxStartedAt = Date.now()
  const tx = Transaction.fromHex(rawtx)
  const parseRawTxMs = Date.now() - parseRawTxStartedAt
  const cache = new Map<string, Transaction>()
  const normalizedOptions: BuildCachedBeefOptions = Array.isArray(options)
    ? { knownTxids: options }
    : options
  const knownTxids = normalizedOptions.knownTxids ?? []
  let overlayParentBeefFetchMs: number | undefined
  let overlayParentBeefSource: 'client-body' | 'cache' | 'overlay' | 'none' = 'none'
  let seedBeef: Beef | null = null
  const overlayParent = normalizedOptions.overlayBsv21Parent
  const prefetchB64 = normalizedOptions.overlayParentBeefBase64?.trim()

  if (overlayParent && prefetchB64) {
    const overlayFetchStartedAt = Date.now()
    try {
      seedBeef = Beef.fromBinary(Array.from(Buffer.from(prefetchB64, 'base64')))
      overlayParentBeefFetchMs = Date.now() - overlayFetchStartedAt
      overlayParentBeefSource = 'client-body'
      console.log('[beef-cache] overlay parent BEEF from client prefetch', {
        elapsedMs: overlayParentBeefFetchMs,
        originId: overlayParent.originId,
        txid: overlayParent.txid,
      })
    } catch (error) {
      console.warn('[beef-cache] overlay parent BEEF prefetch base64 invalid; fetching server-side', {
        originId: overlayParent.originId,
        txid: overlayParent.txid,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (!seedBeef && overlayParent) {
    const result = await fetchOverlayBsv21ParentBeef(overlayParent)
    seedBeef = result.beef
    overlayParentBeefFetchMs = result.elapsedMs
    overlayParentBeefSource = seedBeef ? result.source : 'none'
  }
  const preparedParents = new Map(
    (normalizedOptions.fundingParents ?? [])
      .filter((parent) => isValidTxid(parent.txid) && parent.rawtx.trim())
      .map((parent) => [parent.txid, parent])
  )

  const sourceTxids = tx.inputs
    .map((input) => input.sourceTXID)
    .filter((id): id is string => !!id)
  if (sourceTxids.length !== tx.inputs.length) {
    throw new Error('A required source transaction is missing from the raw transaction inputs')
  }
  const uniqueSourceTxids = Array.from(new Set(sourceTxids))
	const ignoredKnownTxidCount = knownTxids.filter(
		(txid) => isValidTxid(txid) && uniqueSourceTxids.includes(txid)
	).length
  const overlaySeededInputTxidCount = seedBeef
    ? uniqueSourceTxids.filter((sourceTxid) => seedBeef.findTxid(sourceTxid)).length
    : 0
  const txidsToHydrate = seedBeef
    ? uniqueSourceTxids.filter((sourceTxid) => !seedBeef.findTxid(sourceTxid))
    : uniqueSourceTxids

  const hydrateStartedAt = Date.now()
  const inFlight = new Map<string, Promise<Transaction>>()
  const hydrated = await Promise.all(
    txidsToHydrate.map((sourceTxid) => hydrateTransaction(sourceTxid, cache, preparedParents, inFlight))
  )
  const hydrateMs = Date.now() - hydrateStartedAt
	const hydratedByTxid = new Map(txidsToHydrate.map((sourceTxid, index) => [sourceTxid, hydrated[index]]))
  tx.inputs.forEach((input, i) => {
    const sourceTxid = input.sourceTXID
		if (!sourceTxid) {
      return
    }
    const sourceTransaction = hydratedByTxid.get(sourceTxid)
    if (sourceTransaction) {
      input.sourceTransaction = sourceTransaction
    }
  })

  const serializeStartedAt = Date.now()
	const beef = transactionToHexAtomicBeef(tx, seedBeef ?? undefined)
  const serializeBeefMs = Date.now() - serializeStartedAt
  const timings = {
    parseRawTxMs,
    overlayParentBeefFetchMs,
    overlayParentBeefSource,
    hydrateMs,
    serializeBeefMs,
    elapsedMs: Date.now() - startedAt,
    overlaySeededInputTxidCount,
    hydratedInputTxidCount: txidsToHydrate.length,
    preparedFundingParentCount: preparedParents.size,
  }

  console.log('[beef-cache] built broadcast beef', {
    txid: tx.id('hex'),
    inputCount: tx.inputs.length,
		ignoredKnownTxidCount,
    overlaySeedUsed: Boolean(seedBeef),
    beefLength: beef.length,
    ...timings,
  })

  return {
    beef,
    timings,
  }
}

export async function persistBroadcastTransaction(params: {
  txid: string
  rawtx: string
}): Promise<void> {
  const { txid, rawtx } = params
  const tx = Transaction.fromHex(rawtx)
  const computedTxid = tx.id('hex')

  if (computedTxid !== txid) {
    throw new Error(`TXID mismatch. Expected ${txid}, computed ${computedTxid}`)
  }

  writeHotRawTransactionHex(txid, rawtx)
}