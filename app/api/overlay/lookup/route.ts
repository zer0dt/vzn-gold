import { NextResponse } from 'next/server'
import { Transaction, Utils } from '@bsv/sdk'

import { normalizeOverlayBaseUrl, overlayUpstreamHeaders } from '@/app/lib/overlay-url'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OVERLAY_URL = process.env.OVERLAY_URL ?? 'http://localhost:8080'
const OVERLAY_LOOKUP_SERVICE = process.env.OVERLAY_LOOKUP_SERVICE ?? 'ls_llm21_vzn'
const MAP_PREFIX = '1PuQa7K62MiKCtssSLKy1kh56WWU7MtUR5'
const LOCK_SCRIPT_PARAM_PREFIX =
  '2097dfd76851bf465e8f715593b217714858bbe9570ff3bd5e33840a34e20ff0262102ba79df5f8ae7604a9830f03c7933028186aede0675a16f025dc4f8be8eec0382201008ce7480da41702918d1ec8e6849ba32b4d65b1e40dc669c31a1e6306b266c000014'
const ORDINAL_MARKER = '0063036f726451'

type OverlayOutput = {
  beef?: number[]
  outputIndex?: number
  context?: unknown
}

type LookupPayload = {
  type?: string
  outputs?: OverlayOutput[]
}

function readPushData(bytes: Buffer, offset: number): { data: Buffer; nextOffset: number } | null {
  const op = bytes[offset]
  if (op == null) return null

  if (op >= 0x01 && op <= 0x4b) {
    const start = offset + 1
    const end = start + op
    if (end > bytes.length) return null
    return { data: bytes.subarray(start, end), nextOffset: end }
  }

  if (op === 0x4c) {
    const len = bytes[offset + 1]
    if (len == null) return null
    const start = offset + 2
    const end = start + len
    if (end > bytes.length) return null
    return { data: bytes.subarray(start, end), nextOffset: end }
  }

  if (op === 0x4d) {
    const len = bytes.readUInt16LE(offset + 1)
    const start = offset + 3
    const end = start + len
    if (end > bytes.length) return null
    return { data: bytes.subarray(start, end), nextOffset: end }
  }

  return null
}

function readPushes(scriptHex: string): string[] {
  const bytes = Buffer.from(scriptHex, 'hex')
  if (bytes.length < 2 || bytes[0] !== 0x00 || bytes[1] !== 0x6a) return []

  const pushes: string[] = []
  let i = 2
  while (i < bytes.length) {
    const push = readPushData(bytes, i)
    if (!push) return []
    pushes.push(Utils.toUTF8([...push.data]))
    i = push.nextOffset
  }
  return pushes
}

function decodeMapLike(scriptHex: string): { appName: string; postTxid: string } | null {
  const fields = readPushes(scriptHex)
  if (fields.length < 8) return null
  const [prefix, set, appKey, appName, typeKey, type, txKey, postTxid] = fields
  if (
    prefix !== MAP_PREFIX ||
    set !== 'SET' ||
    appKey !== 'app' ||
    typeKey !== 'type' ||
    type !== 'like' ||
    txKey !== 'tx' ||
    !postTxid
  ) {
    return null
  }
  return { appName, postTxid }
}

function decodeOrdinalBsv20(scriptHex: string): Record<string, string> | null {
  const markerIndex = scriptHex.indexOf(ORDINAL_MARKER)
  if (markerIndex < 0 || markerIndex % 2 !== 0) return null

  const bytes = Buffer.from(scriptHex.slice(markerIndex), 'hex')
  if (bytes.length < 11 || bytes[0] !== 0x00 || bytes[1] !== 0x63) return null

  const ordPush = readPushData(bytes, 2)
  if (!ordPush || ordPush.data.toString('utf8') !== 'ord') return null
  if (bytes[ordPush.nextOffset] !== 0x51) return null

  const contentType = readPushData(bytes, ordPush.nextOffset + 1)
  if (!contentType || contentType.data.toString('utf8') !== 'application/bsv-20') return null
  if (bytes[contentType.nextOffset] !== 0x00) return null

  const content = readPushData(bytes, contentType.nextOffset + 1)
  if (!content) return null

  try {
    const parsed = JSON.parse(content.data.toString('utf8')) as Record<string, unknown>
    return Object.fromEntries(
      Object.entries(parsed).flatMap(([key, value]) => {
        return typeof value === 'string' || typeof value === 'number'
          ? [[key, String(value)]]
          : []
      })
    )
  } catch {
    return null
  }
}

function decodeLockOutput(scriptHex: string): { pkh?: string; unlockHeight?: number } {
  const pkhStart = scriptHex.indexOf(LOCK_SCRIPT_PARAM_PREFIX)
  const direct = pkhStart >= 0
    ? {
        pkh: scriptHex.slice(pkhStart + LOCK_SCRIPT_PARAM_PREFIX.length, pkhStart + LOCK_SCRIPT_PARAM_PREFIX.length + 40),
        lockHeightPush: scriptHex.slice(pkhStart + LOCK_SCRIPT_PARAM_PREFIX.length + 40, pkhStart + LOCK_SCRIPT_PARAM_PREFIX.length + 42),
        lockHeightHex: scriptHex.slice(pkhStart + LOCK_SCRIPT_PARAM_PREFIX.length + 42, pkhStart + LOCK_SCRIPT_PARAM_PREFIX.length + 48),
      }
    : null
  const fuzzy = scriptHex.match(/14([0-9a-f]{40})03([0-9a-f]{6})61/i)
  const pkh = direct?.pkh ?? fuzzy?.[1]
  const lockHeightPush = direct?.lockHeightPush ?? (fuzzy ? '03' : undefined)
  const lockHeightHex = direct?.lockHeightHex ?? fuzzy?.[2]

  if (!pkh || !lockHeightHex || !/^[0-9a-f]{40}$/i.test(pkh) || lockHeightPush !== '03') {
    return {}
  }

  return {
    pkh: pkh.toLowerCase(),
    unlockHeight: Buffer.from(lockHeightHex, 'hex').readUIntLE(0, 3),
  }
}

function enrichOutput(output: OverlayOutput) {
  if (!Array.isArray(output.beef)) {
    return output
  }

  try {
    const tx = Transaction.fromBEEF(output.beef)
    const likeOutputIndex = tx.outputs.findIndex((txOutput) => {
      return decodeMapLike(txOutput.lockingScript.toHex()) !== null
    })
    const like = likeOutputIndex >= 0
      ? decodeMapLike(tx.outputs[likeOutputIndex].lockingScript.toHex())
      : null
    const lockOutputIndex = typeof output.outputIndex === 'number' ? output.outputIndex : likeOutputIndex - 1
    const rewardOutputIndex = likeOutputIndex >= 0 ? likeOutputIndex + 1 : -1
    const lockOutput = tx.outputs[lockOutputIndex]
    const rewardOutput = tx.outputs[rewardOutputIndex]
    const lockScript = lockOutput?.lockingScript.toHex()
    const rewardScript = rewardOutput?.lockingScript.toHex()
    const decodedLock = lockScript ? decodeLockOutput(lockScript) : {}
    const decodedReward = rewardScript ? decodeOrdinalBsv20(rewardScript) : null

    return {
      ...output,
      mint: {
        txid: tx.id('hex'),
        outputIndex: output.outputIndex,
        outpoint:
          typeof output.outputIndex === 'number'
            ? `${tx.id('hex')}.${output.outputIndex}`
            : undefined,
        lockSatoshis: lockOutput?.satoshis ?? undefined,
        blockHeight: tx.lockTime,
        inputCount: tx.inputs.length,
        outputCount: tx.outputs.length,
        likeOutputIndex,
        postTxid: like?.postTxid,
        appName: like?.appName,
        lockOutput: {
          index: lockOutputIndex,
          outpoint: `${tx.id('hex')}.${lockOutputIndex}`,
          satoshis: lockOutput?.satoshis ?? undefined,
          pkh: decodedLock.pkh,
          unlockHeight: decodedLock.unlockHeight,
        },
        likeOutput: {
          index: likeOutputIndex,
          postTxid: like?.postTxid,
          appName: like?.appName,
          protocol: MAP_PREFIX,
          type: like ? 'like' : undefined,
        },
        rewardOutput: {
          index: rewardOutputIndex,
          outpoint: `${tx.id('hex')}.${rewardOutputIndex}`,
          satoshis: rewardOutput?.satoshis ?? undefined,
          token: decodedReward ?? undefined,
          pkh: rewardScript?.match(/76a914([0-9a-f]{40})88ac$/i)?.[1]?.toLowerCase(),
        },
      },
    }
  } catch (error) {
    return {
      ...output,
      decodeError: errorMessage(error),
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)

  const query = {
    postTxid: searchParams.get('postTxid') ?? undefined,
    txid: searchParams.get('txid') ?? undefined,
    limit: searchParams.get('limit') ? Number(searchParams.get('limit')) : 25,
    skip: searchParams.get('skip') ? Number(searchParams.get('skip')) : 0,
    sortOrder: searchParams.get('order') === 'asc' ? 'asc' : 'desc',
  }

  try {
    const upstream = await fetch(`${normalizeOverlayBaseUrl(OVERLAY_URL)}/lookup`, {
      method: 'POST',
      headers: overlayUpstreamHeaders(OVERLAY_URL, { 'Content-Type': 'application/json' }),
      body: JSON.stringify({ service: OVERLAY_LOOKUP_SERVICE, query }),
      cache: 'no-store',
    })

    const text = await upstream.text()
    let payload: unknown
    try {
      payload = JSON.parse(text)
    } catch {
      payload = { raw: text }
    }

    const enriched =
      payload &&
      typeof payload === 'object' &&
      Array.isArray((payload as LookupPayload).outputs)
        ? {
            ...(payload as LookupPayload),
            outputs: ((payload as LookupPayload).outputs ?? []).map(enrichOutput),
          }
        : payload

    return NextResponse.json(enriched, { status: upstream.status })
  } catch (error) {
    return NextResponse.json(
      { error: `overlay unreachable: ${errorMessage(error)}` },
      { status: 502 }
    )
  }
}
