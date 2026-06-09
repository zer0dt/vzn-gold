import { NextResponse } from 'next/server'

import { persistBroadcastTransaction } from '@/app/lib/beef-cache'
import { createClient, createServiceRoleClient } from '@/utils/supabase/server'

export const dynamic = 'force-dynamic'

type SubmitLikeRequest = {
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

function asNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing ${fieldName}`)
  }

  return value.trim()
}

function asInteger(value: unknown, fieldName: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`Invalid ${fieldName}`)
  }

  return value
}

function asNullableInteger(value: unknown, fieldName: string): number | null {
  if (value === null || value === undefined) {
    return null
  }

  return asInteger(value, fieldName)
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await request.json()) as SubmitLikeRequest
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
      return NextResponse.json({ error: 'Invalid contract output index' }, { status: 400 })
    }

    if (satsAmount <= 0 || blocksLocked <= 0 || unlockHeight <= blockHeight) {
      return NextResponse.json({ error: 'Invalid lock parameters' }, { status: 400 })
    }

    await persistBroadcastTransaction({
      txid,
      rawtx,
    })

    const serviceSupabase = createServiceRoleClient()
    const { data, error } = await serviceSupabase
      .from('likes')
      .insert({
        txid,
        contract_id: contractId,
        contract_input_txid: contractInputTxid,
        contract_input_vout: contractInputVout,
        contract_output_vout: contractOutputVout,
        post_txid: postTxid,
        user_id: user.id,
        sats_amount: satsAmount,
        blocks_locked: blocksLocked,
        block_height: blockHeight,
        unlock_height: unlockHeight,
        reward_amount: rewardAmount,
        is_spent: false,
      })
      .select(`* , liker_profile:profiles!likes_user_id_fkey (username, avatar_url)`)
      .single()

    if (error) {
      const status = error.code === '23505' ? 409 : 500
      return NextResponse.json({ error: error.message }, { status })
    }

    return NextResponse.json({ like: data }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to submit like'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
