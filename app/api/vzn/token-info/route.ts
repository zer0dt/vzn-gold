import { NextResponse } from 'next/server'

import { getLatestContractTip } from '@/app/lib/beef-cache'
import type { TokenMeta } from '@/types'

export const dynamic = 'force-dynamic'

const IMMUTABLE_TOKEN_INFO_REVALIDATE_SECONDS = 60 * 60 * 24 * 365

type Bsv21Data = {
  amt?: string
  sym?: string
}

type ContractConfig = {
  sats: number
  blocks: number
  lim?: string
  lastHeight?: string
}

type GorillaBsv20IdResponse = {
  txid?: string
  vout?: number
  amt?: string
  sym?: string
  data?: {
    insc?: {
      json?: Record<string, unknown>
    }
  }
}

async function fetchTokenInfo(originId: string): Promise<GorillaBsv20IdResponse | null> {
  try {
    const url = `https://ordinals.gorillapool.io/api/bsv20/id/${originId}`
    const res = await fetch(url, {
      next: { revalidate: IMMUTABLE_TOKEN_INFO_REVALIDATE_SECONDS },
    })
    if (!res.ok) return null
    return (await res.json()) as GorillaBsv20IdResponse
  } catch {
    return null
  }
}

function parseNumericField(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return undefined
}

function parseStringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function extractContractConfig(tokenMeta: TokenMeta): ContractConfig | null {
  const sats = parseNumericField(tokenMeta.sats)
  const blocks = parseNumericField(tokenMeta.blocks)
  if (sats === undefined || blocks === undefined) {
    return null
  }

  return {
    sats,
    blocks,
    lim: parseStringField(tokenMeta.lim),
    lastHeight: parseStringField(tokenMeta.contractStart),
  }
}

async function fetchLatestContractTipMeta(originId: string): Promise<{ txid: string; outputIndex: number } | null> {
  try {
    return await getLatestContractTip(originId)
  } catch {
    return null
  }
}

async function fetchBsv21Data(originId: string, txid: string): Promise<Bsv21Data | null> {
  try {
    const url = `https://bsv21.1sat.app/api/1sat/bsv21/${originId}/tx/${txid}?beef=false`
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) return null
    const data = await res.json()
    return data?.outputs?.[0]?.data?.bsv21 || null
  } catch {
    return null
  }
}

export async function GET() {
  try {
    const originId = process.env.NEXT_PUBLIC_LLM21_ORIGIN_ID
    if (!originId) {
      return NextResponse.json({ error: 'ORIGIN_ID not configured' }, { status: 500 })
    }

    const originTxid = originId.includes('_') ? originId.split('_')[0] : originId

    // Fetch all data in parallel where possible.
    const [tokenInfo, latestContractTip] = await Promise.all([
      fetchTokenInfo(originId),
      fetchLatestContractTipMeta(originId),
    ])

    const tokenMeta = (tokenInfo?.data?.insc?.json ?? {}) as TokenMeta
    const contractConfig = extractContractConfig(tokenMeta)

    let remainingAmt: string | undefined
    let remainingSym = tokenInfo?.sym || '$VZN'
    let latestOutpointStr = ''
    let latestOutpointTxid = ''

    if (latestContractTip) {
      latestOutpointTxid = latestContractTip.txid
      latestOutpointStr = `${latestContractTip.txid}_${latestContractTip.outputIndex}`

      const bsv21Data = await fetchBsv21Data(originId, latestContractTip.txid)
      if (bsv21Data) {
        remainingAmt = bsv21Data.amt
        remainingSym = bsv21Data.sym || '$VZN'
      }
    }

    const totalCandidate = tokenInfo?.amt ?? tokenMeta?.total ?? tokenMeta?.total_supply ?? tokenMeta?.max_supply ??
      tokenMeta?.max ?? tokenMeta?.supply ?? tokenMeta?.cap ?? tokenMeta?.amount ?? tokenMeta?.amt
    const totalRaw = totalCandidate ? (typeof totalCandidate === 'number' ? String(totalCandidate) : totalCandidate) : undefined

    const enrichedTokenMeta = contractConfig
      ? {
          ...tokenMeta,
          sats: contractConfig.sats,
          blocks: contractConfig.blocks,
          lim: contractConfig.lim,
          contractStart: contractConfig.lastHeight,
        }
      : tokenMeta

    return NextResponse.json({
      originId,
      originTxid: originTxid.trim(),
      latestOutpoint: latestOutpointStr,
      latestOutpointTxid: latestOutpointTxid.trim(),
      tokenMeta: enrichedTokenMeta,
      totalRaw,
      remainingAmt,
      remainingSym,
      sats: contractConfig?.sats,
      blocks: contractConfig?.blocks,
      lim: contractConfig?.lim,
      contractStart: contractConfig?.lastHeight,
    })
  } catch (error) {
    console.error('Error in vzn-token-info API:', error)
    return NextResponse.json({ error: 'Failed to fetch token info' }, { status: 500 })
  }
}
