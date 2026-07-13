import { NextResponse } from 'next/server'

import { isBsv21MinterPoolOp } from '@/app/lib/bsv21-minter-pool'
import { normalizeOverlayBaseUrl, overlayUpstreamHeaders } from '@/app/lib/overlay-url'
import type {
  BranchLike,
  MintTransaction,
  MintTreeResponse,
  MinterOutput,
} from '@/app/tree/types'
import { createServiceRoleClient } from '@/utils/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OVERLAY_URL = process.env.OVERLAY_URL ?? 'http://127.0.0.1:8080'
const HISTORY_PAGE_SIZE = 1_000
const MAX_HISTORY_PAGES = 100

type OverlayOutput = {
  txid?: string
  vout?: number
  outputIndex?: number
  outpoint?: string
  score?: number | string
  spend?: unknown
  spent?: unknown
  spendTxid?: unknown
  spentTxid?: unknown
  data?: {
    bsv21?: {
      address?: string
      amt?: string
      op?: string
      id?: string
    }
  }
}

type NormalizedOutput = {
  id: string
  txid: string
  outputIndex: number
  amount: string
  spendTxid: string | null
}

function parseOutpoint(
  output: OverlayOutput
): { txid: string; outputIndex: number } | null {
  const outputIndex = output.vout ?? output.outputIndex
  if (output.txid && Number.isInteger(outputIndex) && (outputIndex ?? -1) >= 0) {
    return { txid: output.txid, outputIndex: outputIndex as number }
  }

  if (!output.outpoint) return null
  const separator = output.outpoint.includes('_') ? '_' : '.'
  const separatorIndex = output.outpoint.lastIndexOf(separator)
  const txid = output.outpoint.slice(0, separatorIndex)
  const parsedIndex = Number(output.outpoint.slice(separatorIndex + 1))
  return txid && Number.isInteger(parsedIndex) && parsedIndex >= 0
    ? { txid, outputIndex: parsedIndex }
    : null
}

function txidFromSpend(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim()
  if (!value || typeof value !== 'object') return null

  const record = value as Record<string, unknown>
  for (const key of ['txid', 'txId', 'transactionId', 'spendingTxid']) {
    const candidate = record[key]
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return null
}

function normalizeMinterOutput(output: OverlayOutput, originId: string): NormalizedOutput | null {
  const outpoint = parseOutpoint(output)
  const bsv21 = output.data?.bsv21
  if (
    !outpoint ||
    !bsv21 ||
    (outpoint.outputIndex !== 0 && outpoint.outputIndex !== 1) ||
    !isBsv21MinterPoolOp(bsv21.op) ||
    bsv21.id !== originId ||
    bsv21.address ||
    typeof bsv21.amt !== 'string' ||
    !/^[0-9]+$/.test(bsv21.amt)
  ) {
    return null
  }

  return {
    id: `${outpoint.txid}_${outpoint.outputIndex}`,
    ...outpoint,
    amount: bsv21.amt,
    spendTxid:
      txidFromSpend(output.spendTxid) ??
      txidFromSpend(output.spentTxid) ??
      txidFromSpend(output.spend) ??
      txidFromSpend(output.spent),
  }
}

function buildTree(originId: string, rows: OverlayOutput[]): MintTreeResponse {
  const normalizedById = new Map<string, NormalizedOutput>()
  for (const row of rows) {
    const output = normalizeMinterOutput(row, originId)
    if (output) normalizedById.set(output.id, output)
  }
  const normalized = [...normalizedById.values()]

  const root =
    normalized.find((output) => output.id === originId) ??
    normalized.find((output) => `${output.txid}_${output.outputIndex}` === originId)

  if (!root) {
    throw new Error(`Genesis minter output ${originId} was not found in overlay history`)
  }

  const outputsByTxid = new Map<string, NormalizedOutput[]>()
  for (const output of normalized) {
    const siblings = outputsByTxid.get(output.txid) ?? []
    siblings.push(output)
    outputsByTxid.set(output.txid, siblings)
  }
  for (const siblings of outputsByTxid.values()) {
    siblings.sort((a, b) => a.outputIndex - b.outputIndex)
  }

  const outputs: MinterOutput[] = []
  const transactions: MintTransaction[] = [
    {
      txid: root.txid,
      kind: 'genesis',
      depth: 0,
      parentOutputId: null,
      childOutputIds: [root.id],
    },
  ]
  const visited = new Set<string>()
  const queue: Array<{ output: NormalizedOutput; depth: number; parentId: string | null }> = [
    { output: root, depth: 0, parentId: null },
  ]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || visited.has(current.output.id)) continue
    visited.add(current.output.id)

    const children = current.output.spendTxid
      ? (outputsByTxid.get(current.output.spendTxid) ?? [])
      : []
    const childIds = children.map((child) => child.id)

    outputs.push({
      id: current.output.id,
      txid: current.output.txid,
      outputIndex: current.output.outputIndex,
      amount: current.output.amount,
      depth: current.depth,
      status: current.output.spendTxid ? 'spent' : 'live',
      spendTxid: current.output.spendTxid,
      parentId: current.parentId,
      childIds,
    })

    if (current.output.spendTxid) {
      transactions.push({
        txid: current.output.spendTxid,
        kind: 'mint',
        depth: current.depth + 1,
        parentOutputId: current.output.id,
        childOutputIds: childIds,
      })
    }

    for (const child of children) {
      queue.push({
        output: child,
        depth: current.depth + 1,
        parentId: current.output.id,
      })
    }
  }

  const maxDepth = outputs.reduce((maximum, output) => Math.max(maximum, output.depth), 0)
  const liveOutputCount = outputs.filter((output) => output.status === 'live').length

  return {
    originId,
    rootId: root.id,
    outputs,
    transactions,
    likesByBranchId: {},
    stats: {
      outputCount: outputs.length,
      transactionCount: transactions.length,
      liveOutputCount,
      spentOutputCount: outputs.length - liveOutputCount,
      likedBranchCount: 0,
      maxDepth,
    },
  }
}

type LikeRow = {
  txid: string
  post_txid: string
  user_id: string
  sats_amount: number
  contract_input_txid: string
  contract_input_vout: number
}

function appendBranchLike(
  likesByBranchId: Record<string, BranchLike[]>,
  branchId: string,
  outputIds: Set<string>,
  entry: BranchLike
) {
  if (!outputIds.has(branchId)) return

  likesByBranchId[branchId] ??= []
  const exists = likesByBranchId[branchId].some(
    (like) => like.likeTxid === entry.likeTxid
  )
  if (!exists) likesByBranchId[branchId].push(entry)
}

async function fetchLikesByBranchId(
  originId: string,
  outputIds: Set<string>
): Promise<Record<string, BranchLike[]>> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('likes')
    .select('txid, post_txid, user_id, sats_amount, contract_input_txid, contract_input_vout')
    .eq('contract_id', originId)

  if (error || !data) return {}

  const likesByBranchId: Record<string, BranchLike[]> = {}
  for (const row of data as LikeRow[]) {
    if (!row.txid || !row.post_txid || !row.user_id) continue
    if (!row.contract_input_txid || !Number.isInteger(row.contract_input_vout)) continue

    appendBranchLike(
      likesByBranchId,
      `${row.contract_input_txid}_${row.contract_input_vout}`,
      outputIds,
      {
        likeTxid: row.txid,
        postTxid: row.post_txid,
        userId: row.user_id,
        satsAmount: row.sats_amount,
      }
    )
  }

  return likesByBranchId
}

async function fetchHistory(originId: string): Promise<OverlayOutput[]> {
  const topic = `tm_${originId}`
  const rows: OverlayOutput[] = []
  let from: string | null = null

  for (let page = 0; page < MAX_HISTORY_PAGES; page += 1) {
    const url = new URL(
      `${normalizeOverlayBaseUrl(OVERLAY_URL)}/api/1sat/events/${topic}/history`
    )
    url.searchParams.set('limit', String(HISTORY_PAGE_SIZE))
    if (from) url.searchParams.set('from', from)

    const upstream = await fetch(url, {
      method: 'POST',
      headers: overlayUpstreamHeaders(OVERLAY_URL, { 'Content-Type': 'application/json' }),
      body: JSON.stringify([`id:${originId}`]),
      cache: 'no-store',
    })
    const text = await upstream.text()
    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }

    if (!upstream.ok) {
      throw new Error(
        `Overlay minter history lookup failed (${upstream.status}): ${String(text).slice(0, 300)}`
      )
    }
    if (!Array.isArray(payload)) {
      throw new Error('Overlay minter history returned an unexpected response')
    }

    const pageRows = payload as OverlayOutput[]
    rows.push(...pageRows)
    if (pageRows.length < HISTORY_PAGE_SIZE) return rows

    const nextFrom = pageRows.at(-1)?.score
    if (
      (typeof nextFrom !== 'number' && typeof nextFrom !== 'string') ||
      String(nextFrom) === from
    ) {
      throw new Error('Overlay history pagination did not return a usable next score')
    }
    from = String(nextFrom)
  }

  throw new Error(`Overlay history exceeded ${MAX_HISTORY_PAGES} pages`)
}

export async function GET() {
  const originId = process.env.NEXT_PUBLIC_LLM21_ORIGIN_ID?.trim()
  if (!originId) {
    return NextResponse.json(
      { error: 'NEXT_PUBLIC_LLM21_ORIGIN_ID is not configured' },
      { status: 500 }
    )
  }

  try {
    const history = await fetchHistory(originId)
    const tree = buildTree(originId, history)
    const outputIds = new Set(tree.outputs.map((output) => output.id))
    const likesByBranchId = await fetchLikesByBranchId(originId, outputIds)

    return NextResponse.json({
      ...tree,
      likesByBranchId,
      stats: {
        ...tree.stats,
        likedBranchCount: Object.keys(likesByBranchId).length,
      },
    } satisfies MintTreeResponse)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return NextResponse.json({ error: message }, { status: 502 })
  }
}
