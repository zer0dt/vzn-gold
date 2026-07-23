import { NextResponse } from 'next/server'

import { isBsv21MinterPoolOp } from '@/app/lib/bsv21-minter-pool'
import { normalizeOverlayBaseUrl, overlayUpstreamHeaders } from '@/app/lib/overlay-url'

const DYNAMIC_REVALIDATE_SECONDS = 60
const IMMUTABLE_REVALIDATE_SECONDS = 60 * 60 * 24 * 365
const OVERLAY_URL = process.env.OVERLAY_URL ?? 'http://localhost:3001'

type GorillaTokenInfoResponse = {
  amt?: string
  sym?: string
  data?: {
    insc?: {
      json?: {
        lim?: string | number
      }
    }
  }
}

type OverlayOutputData = {
  txid?: string
  vout?: number
  outputIndex?: number
  outpoint?: string
  data?: {
    bsv21?: {
      address?: string
      amt?: string
      id?: string
      op?: string
    }
  }
}

function parseMintLimitPerLock(tokenInfo: GorillaTokenInfoResponse): number | null {
  const lim = tokenInfo.data?.insc?.json?.lim
  if (typeof lim === 'number' && Number.isFinite(lim) && lim > 0) return lim
  if (typeof lim === 'string' && lim.trim() !== '') {
    const n = Number(lim)
    if (Number.isFinite(n) && n > 0) return n
  }
  return null
}

function parseAmount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  throw new Error('Invalid token amount')
}

function overlayOutputIndex(output: OverlayOutputData): number | null {
  if (typeof output.vout === 'number') return output.vout
  if (typeof output.outputIndex === 'number') return output.outputIndex

  if (output.outpoint) {
    const separator = output.outpoint.includes('_') ? '_' : '.'
    const outputIndexText = output.outpoint.split(separator).at(-1)
    const outputIndex = Number(outputIndexText)
    if (Number.isInteger(outputIndex) && outputIndex >= 0) return outputIndex
  }

  return null
}

function isRemainingMinterOutput(output: OverlayOutputData, originId: string): boolean {
  const outputIndex = overlayOutputIndex(output)
  const bsv21 = output.data?.bsv21
  if (!bsv21) return false

  return (
    outputIndex !== null &&
    (outputIndex === 0 || outputIndex === 1) &&
    isBsv21MinterPoolOp(bsv21.op) &&
    bsv21.id === originId &&
    typeof bsv21.amt === 'string' &&
    /^[0-9]+$/.test(bsv21.amt) &&
    !bsv21.address
  )
}

/** Payee / wallet holdings: transfer outputs with an address (mint rewards + later moves). */
function isPayeeTokenOutput(output: OverlayOutputData, originId: string): boolean {
  const bsv21 = output.data?.bsv21
  if (!bsv21) return false

  return (
    bsv21.id === originId &&
    typeof bsv21.address === 'string' &&
    bsv21.address.length > 0 &&
    typeof bsv21.amt === 'string' &&
    /^[0-9]+$/.test(bsv21.amt)
  )
}

type OverlaySupplyBreakdown = {
  /** Unspent minter-pool supply (vout 0/1, no address). */
  remainingFromMinters: number
  /** Unspent addressed token supply — actual minted/circulating to wallets. */
  mintedFromPayees: number
}

async function fetchSupplyBreakdownFromOverlay(
  originId: string,
  options?: { refresh?: boolean }
): Promise<OverlaySupplyBreakdown> {
  const topic = `tm_${originId}`
  const event = `id:${originId}`
  const query = new URLSearchParams({ limit: '1000' })
  const url = `${normalizeOverlayBaseUrl(OVERLAY_URL)}/api/1sat/events/${topic}/unspent?${query.toString()}`

  const response = await fetch(url, {
    method: 'POST',
    headers: overlayUpstreamHeaders(OVERLAY_URL, { 'Content-Type': 'application/json' }),
    body: JSON.stringify([event]),
    ...(options?.refresh
      ? { cache: 'no-store' as const }
      : { next: { revalidate: DYNAMIC_REVALIDATE_SECONDS } }),
  })

  if (!response.ok) {
    throw new Error(`Failed to fetch overlay token outputs: ${response.status}`)
  }

  const outputs = (await response.json()) as unknown
  if (!Array.isArray(outputs)) {
    throw new Error('Overlay token outputs response was not an array')
  }

  let remainingFromMinters = 0
  let mintedFromPayees = 0

  for (const output of outputs) {
    const overlayOutput = output as OverlayOutputData
    const amt = overlayOutput.data?.bsv21?.amt
    if (typeof amt !== 'string' || !/^[0-9]+$/.test(amt)) continue

    if (isRemainingMinterOutput(overlayOutput, originId)) {
      remainingFromMinters += parseAmount(amt)
    } else if (isPayeeTokenOutput(overlayOutput, originId)) {
      mintedFromPayees += parseAmount(amt)
    }
  }

  return { remainingFromMinters, mintedFromPayees }
}

async function fetchMintedSupply(options?: { refresh?: boolean }) {
  const originId = process.env.NEXT_PUBLIC_LLM21_ORIGIN_ID
  if (!originId) {
    throw new Error('Token ID not configured')
  }

  const tokenInfoUrl = `https://ordinals.gorillapool.io/api/bsv20/id/${originId}`

  const fetchOptions = options?.refresh
    ? { cache: 'no-store' as const }
    : undefined

  const [tokenInfoResponse, supply] = await Promise.all([
    fetch(
      tokenInfoUrl,
      fetchOptions ?? { next: { revalidate: IMMUTABLE_REVALIDATE_SECONDS } }
    ),
    fetchSupplyBreakdownFromOverlay(originId, options),
  ])

  if (!tokenInfoResponse.ok) {
    throw new Error(`Failed to fetch token info: ${tokenInfoResponse.status}`)
  }

  const tokenInfo = (await tokenInfoResponse.json()) as GorillaTokenInfoResponse

  const totalTokens = parseAmount(tokenInfo.amt)

  // Prefer payee holdings for "minted". `total - minterRemaining` overstates minted when the
  // parallel mint tree has gaps (spent parents / missing tips) on the overlay — locally that
  // showed ~1.3B minted while wallet transfers only summed to ~114k.
  const treeMinted = Math.max(totalTokens - supply.remainingFromMinters, 0)
  const mintedTokens = supply.mintedFromPayees > 0 ? supply.mintedFromPayees : treeMinted
  const remainingTokens = Math.max(totalTokens - mintedTokens, 0)

  const rawSym = typeof tokenInfo.sym === 'string' ? tokenInfo.sym.trim() : ''
  const symbol = rawSym.startsWith('$') ? rawSym.slice(1).trim() : rawSym

  const mintLimit = parseMintLimitPerLock(tokenInfo) ?? 1000

  return {
    symbol,
    mintLimit,
    totalTokens,
    remainingTokens,
    mintedTokens,
    mintedPercentage: totalTokens > 0 ? Number(((mintedTokens / totalTokens) * 100).toFixed(4)) : 0,
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const shouldRefresh = searchParams.get('refresh') === '1'
    const mintedSupply = shouldRefresh
      ? await fetchMintedSupply({ refresh: true })
      : await fetchMintedSupply()

    return NextResponse.json(
      mintedSupply,
      {
        headers: {
          'Cache-Control': shouldRefresh
            ? 'no-store, no-cache, must-revalidate, max-age=0'
            : 's-maxage=60, stale-while-revalidate=300',
        },
      }
    )
  } catch (error) {
    console.error('Error fetching network stats:', error)

    return NextResponse.json(
      {
        error: 'Failed to fetch network stats',
        mintedTokens: 0,
        mintedPercentage: 0,
        mintLimit: 1000,
      },
      { status: 500 }
    )
  }
}