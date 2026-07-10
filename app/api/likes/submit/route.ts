import { NextResponse } from 'next/server'

import {
  LockLikeSubmitError,
  persistLockLikeForCurrentUser,
  type SubmitLockLikeRequest,
} from '@/app/lib/lock-like-submit'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SubmitLockLikeRequest
    const result = await persistLockLikeForCurrentUser(body)
    return NextResponse.json({ like: result.like }, { status: result.status })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to submit like'
    const status = error instanceof LockLikeSubmitError ? error.status : 400
    return NextResponse.json({ error: message }, { status })
  }
}
