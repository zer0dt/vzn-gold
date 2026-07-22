import { ARC, Transaction as SdkTransaction } from '@bsv/sdk'

export type DirectArcBroadcastResult = {
  txid: string
  status: 'accepted' | 'already-known'
  arc?: Record<string, string>
}

export class DirectArcBroadcastError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'DirectArcBroadcastError'
  }
}

function errorDetails(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== 'object') return { message: String(error) }
  const candidate = error as Record<string, unknown>
  const details: Record<string, unknown> = {
    ...(error instanceof Error ? { name: error.name, message: error.message } : {}),
  }
  for (const key of ['status', 'statusCode', 'code', 'type', 'detail', 'details']) {
    if (candidate[key] !== undefined) details[key] = candidate[key]
  }
  const response = candidate.response
  if (response && typeof response === 'object') {
    const responseRecord = response as Record<string, unknown>
    details.response = Object.fromEntries(
      ['status', 'statusCode', 'statusText', 'body', 'data', 'detail', 'details']
        .filter((key) => responseRecord[key] !== undefined)
        .map((key) => [key, responseRecord[key]])
    )
  }
  return details
}

function resultText(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const candidate = value as Record<string, unknown>
  return ['status', 'txStatus', 'message', 'code', 'description', 'title', 'detail', 'extraInfo']
    .map((key) => candidate[key])
    .filter((item): item is string => typeof item === 'string')
    .join(' ')
    .toLowerCase()
}

function isRejected(result: unknown): boolean {
  if (!result || typeof result !== 'object') return false
  const candidate = result as Record<string, unknown>
  return ['status', 'txStatus', 'code'].some((key) => {
    const value = candidate[key]
    return typeof value === 'string' && ['error', 'rejected'].includes(value.toLowerCase())
  })
}

function isAlreadyKnown(value: unknown): boolean {
  const text =
    typeof value === 'object' && value !== null
      ? `${resultText(value)} ${JSON.stringify(value).toLowerCase()}`
      : String(value).toLowerCase()
  return /already|duplicate|known|seen|previously/.test(text)
}

function resultTxid(result: unknown): string | null {
  if (!result || typeof result !== 'object') return null
  const candidate = result as Record<string, unknown>
  for (const key of ['txid', 'txId', 'tx_id', 'hash']) {
    const value = candidate[key]
    if (typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value)) {
      return value.toLowerCase()
    }
  }
  return null
}

function resultForClient(result: unknown): Record<string, string> | undefined {
  if (!result || typeof result !== 'object') return undefined
  const candidate = result as Record<string, unknown>
  const output: Record<string, string> = {}
  for (const key of ['status', 'message', 'txid', 'txId', 'txStatus', 'code', 'description', 'title']) {
    const value = candidate[key]
    if (typeof value === 'string' && value.length > 0) output[key] = value
  }
  return Object.keys(output).length > 0 ? output : undefined
}

export async function broadcastBeefDirectToArc(beef: string): Promise<DirectArcBroadcastResult> {
  const apiKey = process.env.ARC_API_KEY
  if (!apiKey) {
    throw new DirectArcBroadcastError('ARC API key not configured', 500)
  }

  let tx: SdkTransaction
  try {
    tx = SdkTransaction.fromHexBEEF(beef)
  } catch (error) {
    throw new DirectArcBroadcastError('Invalid BEEF format', 400, errorDetails(error))
  }

  const txid = tx.id('hex')
  try {
    console.log('ARC broadcast request', {
      txid,
      beefLength: beef.length,
      arcUrl: 'https://api.taal.com/arc',
    })
    const result = await tx.broadcast(new ARC('https://api.taal.com/arc', apiKey))
    const arc = resultForClient(result)

    if (isRejected(result)) {
      throw new DirectArcBroadcastError(
        arc?.description || arc?.message || arc?.code || 'ARC broadcast failed',
        502,
        { arc }
      )
    }

    const arcTxid = resultTxid(result)
    if (arcTxid && arcTxid !== txid) {
      throw new DirectArcBroadcastError(
        'ARC returned a TXID that does not match the submitted transaction',
        502,
        { txid, arcTxid, arc }
      )
    }

    return {
      txid,
      status: isAlreadyKnown(result) ? 'already-known' : 'accepted',
      arc,
    }
  } catch (error) {
    if (error instanceof DirectArcBroadcastError) throw error
    const details = errorDetails(error)
    if (isAlreadyKnown(details)) {
      return {
        txid,
        status: 'already-known',
        arc: {
          message:
            typeof details.message === 'string' ? details.message : 'Transaction already known',
        },
      }
    }
    throw new DirectArcBroadcastError(
      typeof details.message === 'string' ? details.message : 'ARC broadcast failed',
      502,
      details
    )
  }
}
