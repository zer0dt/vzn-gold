import { createClient } from '@/utils/supabase/server'
import { type NextRequest, NextResponse } from 'next/server'

type SpentRow = {
  txid: string
  spent_txid: string
}

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

    const body = await request.json()
    const spent = body?.spent

    const normalizedSpentRows = Array.isArray(spent)
      ? spent.filter((row): row is SpentRow => {
          if (
            !row ||
            typeof row !== 'object' ||
            typeof (row as SpentRow).txid !== 'string' ||
            typeof (row as SpentRow).spent_txid !== 'string'
          ) {
            return false
          }
          const a = (row as SpentRow).txid.trim().toLowerCase()
          const b = (row as SpentRow).spent_txid.trim().toLowerCase()
          return a.length === 64 && b.length === 64 && a !== b
        })
      : []

    if (normalizedSpentRows.length === 0) {
      return NextResponse.json({ error: 'No valid spent updates (spent_txid must differ from txid)' }, { status: 400 })
    }

    const updatedSpentTxids: string[] = []

    const updateResults = await Promise.all(
      normalizedSpentRows.map(async (row) => {
        const { data, error } = await supabase
          .from('likes')
          .update({
            is_spent: true,
            spent_txid: row.spent_txid.trim(),
          })
          .eq('user_id', user.id)
          .eq('txid', row.txid.trim())
          .select('txid')

        if (error) {
          throw error
        }

        return (data ?? []).map((item) => item.txid)
      })
    )

    updatedSpentTxids.push(...updateResults.flat())

    return NextResponse.json({
      success: true,
      updatedSpentCount: updatedSpentTxids.length,
      updatedSpentTxids,
    })
  } catch (error) {
    console.error('Reconcile unlockable likes route error:', error)
    return NextResponse.json({ error: 'Failed to reconcile unlockable likes' }, { status: 500 })
  }
}
