import { persistBroadcastTransaction } from '@/app/lib/beef-cache'
import { createClient, createServiceRoleClient } from '@/utils/supabase/server'

export type SubmitLockLikeRequest = {
  txid?: unknown
  rawtx?: unknown
  contractId?: unknown
  contractInputTxid?: unknown
  contractInputVout?: unknown
  contractOutputVout?: unknown
  postTxid?: unknown
  satsAmount?: unknown
  blocksLocked?: unknown
  blockHeight?: unknown
  unlockHeight?: unknown
  rewardAmount?: unknown
}

export type PersistedLockLike = {
  like: { txid: string } & Record<string, unknown>
  status: number
}

export class LockLikeSubmitError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'LockLikeSubmitError'
    this.status = status
  }
}

function asNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new LockLikeSubmitError(`Missing ${fieldName}`, 400)
  }

  return value.trim()
}

function asInteger(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new LockLikeSubmitError(`Invalid ${fieldName}`, 400)
  }

  return value
}

function asNullableInteger(value: unknown, fieldName: string): number | null {
  if (value === null || value === undefined) {
    return null
  }

  return asInteger(value, fieldName)
}

async function getAuthenticatedUserId(): Promise<string> {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    throw new LockLikeSubmitError('Unauthorized', 401)
  }

  return user.id
}

export async function persistLockLikeForCurrentUser(
  body: SubmitLockLikeRequest
): Promise<PersistedLockLike> {
  const userId = await getAuthenticatedUserId()
  const txid = asNonEmptyString(body.txid, 'txid')
  const rawtx = asNonEmptyString(body.rawtx, 'rawtx')
  const contractId = asNonEmptyString(body.contractId, 'contractId')
  const contractInputTxid = asNonEmptyString(body.contractInputTxid, 'contractInputTxid')
  const contractInputVout = asInteger(body.contractInputVout, 'contractInputVout')
  const contractOutputVout = asNullableInteger(body.contractOutputVout, 'contractOutputVout')
  const postTxid = asNonEmptyString(body.postTxid, 'postTxid')
  const satsAmount = asInteger(body.satsAmount, 'satsAmount')
  const blocksLocked = asInteger(body.blocksLocked, 'blocksLocked')
  const blockHeight = asInteger(body.blockHeight, 'blockHeight')
  const unlockHeight = asInteger(body.unlockHeight, 'unlockHeight')
  const rewardAmount = asNullableInteger(body.rewardAmount, 'rewardAmount')

  if (contractInputVout < 0 || (contractOutputVout !== null && contractOutputVout < 0)) {
    throw new LockLikeSubmitError('Invalid contract output index', 400)
  }

  if (satsAmount <= 0 || blocksLocked <= 0 || unlockHeight <= blockHeight) {
    throw new LockLikeSubmitError('Invalid lock parameters', 400)
  }

  await persistBroadcastTransaction({ txid, rawtx })

  const serviceSupabase = createServiceRoleClient()
  const selectColumns = `* , liker_profile:profiles!likes_user_id_fkey (username, avatar_url)`
  const insertPayload = {
    txid,
    contract_id: contractId,
    contract_input_txid: contractInputTxid,
    contract_input_vout: contractInputVout,
    contract_output_vout: contractOutputVout,
    post_txid: postTxid,
    user_id: userId,
    sats_amount: satsAmount,
    blocks_locked: blocksLocked,
    block_height: blockHeight,
    unlock_height: unlockHeight,
    reward_amount: rewardAmount,
    is_spent: false,
  }
  const { data, error } = await serviceSupabase
    .from('likes')
    .insert(insertPayload)
    .select(selectColumns)
    .single()

  if (!error && data) {
    return { like: data, status: 201 }
  }

  if (error?.code === '23505') {
    const { data: existing, error: existingError } = await serviceSupabase
      .from('likes')
      .select(selectColumns)
      .eq('txid', txid)
      .single()

    if (!existingError && existing) {
      return { like: existing, status: 200 }
    }
  }

  throw new LockLikeSubmitError(error?.message || 'Failed to persist like', error?.code === '23505' ? 409 : 500)
}
