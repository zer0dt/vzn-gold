import { NextResponse } from 'next/server'
import { ARC, Transaction as SdkTransaction } from '@bsv/sdk'

function getErrorDetails(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== 'object') {
    return { message: String(error) }
  }

  const details: Record<string, unknown> = {}

  if (error instanceof Error) {
    details.name = error.name
    details.message = error.message
    details.stack = error.stack
  }

  const candidate = error as Record<string, unknown>

  for (const key of ['status', 'statusCode', 'code', 'type', 'detail', 'details']) {
    if (candidate[key] !== undefined) {
      details[key] = candidate[key]
    }
  }

  const response = candidate.response
  if (response && typeof response === 'object') {
    const responseRecord = response as Record<string, unknown>
    details.response = {}

    for (const key of ['status', 'statusCode', 'statusText', 'body', 'data', 'detail', 'details']) {
      if (responseRecord[key] !== undefined) {
        ;(details.response as Record<string, unknown>)[key] = responseRecord[key]
      }
    }
  }

  return Object.keys(details).length > 0 ? details : { error }
}

function getArcFailureMessage(result: unknown): string | null {
  if (!result || typeof result !== 'object') {
    return null
  }

  const candidate = result as Record<string, unknown>
  const status = typeof candidate.status === 'string' ? candidate.status.toLowerCase() : ''
  const txStatus = typeof candidate.txStatus === 'string' ? candidate.txStatus.toLowerCase() : ''
  const code = typeof candidate.code === 'string' ? candidate.code.toLowerCase() : ''

  if (
    status !== 'error' &&
    status !== 'rejected' &&
    txStatus !== 'rejected' &&
    code !== 'rejected'
  ) {
    return null
  }

  if (typeof candidate.description === 'string' && candidate.description.length > 0) {
    return candidate.description
  }

  if (typeof candidate.code === 'string' && candidate.code.length > 0) {
    return candidate.code
  }

  return 'ARC broadcast failed'
}

function extractArcTxid(result: unknown): string | null {
  if (!result || typeof result !== 'object') {
    return null
  }

  const candidate = result as Record<string, unknown>
  for (const key of ['txid', 'txId', 'tx_id', 'hash'] as const) {
    const value = candidate[key]
    if (typeof value === 'string' && /^[0-9a-f]{64}$/i.test(value)) {
      return value.toLowerCase()
    }
  }

  return null
}

function isAlreadyKnownArcResult(result: unknown): boolean {
  if (!result || typeof result !== 'object') {
    return false
  }

  const candidate = result as Record<string, unknown>
  const text = ['status', 'message', 'code', 'description', 'title', 'detail', 'extraInfo']
    .map((key) => candidate[key])
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase()

  return /already|duplicate|known|seen|previously/.test(text)
}

function isAlreadyKnownArcError(details: Record<string, unknown>): boolean {
  const text = JSON.stringify(details).toLowerCase()
  return /already|duplicate|known|seen|previously/.test(text)
}

/** JSON-serializable subset of ARC `tx.broadcast` result for the client. */
function arcResultForClient(result: unknown): Record<string, string> | undefined {
  if (!result || typeof result !== 'object') {
    return undefined
  }

  const r = result as Record<string, unknown>
  const out: Record<string, string> = {}

  for (const key of ['status', 'message', 'txid', 'txId', 'txStatus', 'code', 'description', 'title'] as const) {
    const v = r[key]
    if (typeof v === 'string' && v.length > 0) {
      out[key] = v
    }
  }

  return Object.keys(out).length > 0 ? out : undefined
}

export async function POST(req: Request) {
  try {
    const { beef } = await req.json()

    if (!beef || typeof beef !== 'string' || beef.trim().length === 0) {
      console.warn('ARC broadcast rejected: missing beef payload', {
        beefType: typeof beef,
        beefLength: typeof beef === 'string' ? beef.length : undefined,
      })
      return NextResponse.json({ error: 'Missing beef' }, { status: 400 })
    }

    const apiKey = process.env.ARC_API_KEY
    if (!apiKey) {
      console.error('ARC broadcast failed: ARC_API_KEY is not configured')
      return NextResponse.json({ error: 'ARC API key not configured' }, { status: 500 })
    }

    let tx: SdkTransaction
    try {
      // Accepts BEEF V1, V2, or Atomic (SDK parses via Beef.fromBinary)
      tx = SdkTransaction.fromHexBEEF(beef)
    } catch (error) {
      console.error('ARC broadcast rejected: invalid BEEF format', {
        beefLength: beef.length,
        error: getErrorDetails(error),
      })
      return NextResponse.json({ error: 'Invalid BEEF format' }, { status: 400 })
    }

    const txid = tx.id('hex')

    try {
      console.log('ARC broadcast request', {
        txid,
        beefLength: beef.length,
        arcUrl: 'https://api.taal.com/arc',
      })
      const arc = new ARC('https://api.taal.com/arc', apiKey)
      const result = await tx.broadcast(arc)
      console.log('ARC broadcast response', {
        txid,
        result: result !== undefined ? result : 'void',
        resultType: typeof result,
        resultKeys: result && typeof result === 'object' ? Object.keys(result) : undefined,
      })

      const failureMessage = getArcFailureMessage(result)
      if (failureMessage) {
        console.error('ARC broadcast returned failure payload', {
          txid,
          result,
        })
        return NextResponse.json(
          { error: failureMessage, arc: arcResultForClient(result) },
          { status: 502 }
        )
      }

      const arcTxid = extractArcTxid(result)
      if (arcTxid && arcTxid !== txid) {
        console.error('ARC broadcast txid mismatch', {
          localTxid: txid,
          arcTxid,
          result,
        })
        return NextResponse.json(
          {
            error: 'ARC returned a TXID that does not match the submitted transaction',
            txid,
            arcTxid,
            arc: arcResultForClient(result),
          },
          { status: 502 }
        )
      }

      return NextResponse.json(
        {
          txid,
          status: isAlreadyKnownArcResult(result) ? 'already-known' : 'accepted',
          arc: arcResultForClient(result),
        },
        { status: 201 }
      )
    } catch (error: unknown) {
      const details = getErrorDetails(error)
      const message =
        typeof details.message === 'string' && details.message.length > 0
          ? details.message
          : 'ARC broadcast failed'
      console.error('ARC broadcast error', {
        txid,
        error: details,
        rawError: error,
      })
      if (isAlreadyKnownArcError(details)) {
        return NextResponse.json(
          {
            txid,
            status: 'already-known',
            arc: {
              message,
            },
          },
          { status: 201 }
        )
      }
      return NextResponse.json({ error: message }, { status: 502 })
    }
  } catch (error: unknown) {
    const details = getErrorDetails(error)
    const message =
      typeof details.message === 'string' && details.message.length > 0
        ? details.message
        : 'Unknown server error'
    console.error('ARC broadcast route error', { error: details })
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
