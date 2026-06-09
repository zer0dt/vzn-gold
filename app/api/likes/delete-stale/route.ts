import { createClient } from '@/utils/supabase/server'
import { type NextRequest, NextResponse } from 'next/server'

export async function PATCH(request: NextRequest) {
  try {
    const supabase = await createClient()
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const { txids } = await request.json()

    if (!Array.isArray(txids) || txids.length === 0) {
      return NextResponse.json({ error: 'txids array is required' }, { status: 400 })
    }

    const normalizedTxids = txids
      .filter((txid): txid is string => typeof txid === 'string')
      .map((txid) => txid.trim())
      .filter((txid) => txid.length > 0)

    if (normalizedTxids.length === 0) {
      return NextResponse.json({ error: 'No valid txids provided' }, { status: 400 })
    }

    const { data, error } = await supabase
      .from('likes')
      .delete()
      .eq('user_id', user.id)
      .in('txid', normalizedTxids)
      .select('txid')

    if (error) {
      console.error('Failed to delete stale likes:', error)
      return NextResponse.json({ error: 'Failed to delete stale likes' }, { status: 500 })
    }

    return NextResponse.json({
      success: true,
      deletedCount: data?.length ?? 0,
      deletedTxids: (data ?? []).map((row) => row.txid),
    })
  } catch (error) {
    console.error('Delete stale likes route error:', error)
    return NextResponse.json({ error: 'Failed to delete stale likes' }, { status: 500 })
  }
}
