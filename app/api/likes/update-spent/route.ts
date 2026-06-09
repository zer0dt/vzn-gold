import { createClient } from '@/utils/supabase/server'
import { type NextRequest, NextResponse } from 'next/server'

export async function PATCH(request: NextRequest) {
  try {
    // Check authentication first
    const supabase = await createClient()
    
    // Get the current user
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    const { txid, spent_txid } = await request.json()

    if (!txid || !spent_txid) {
      return NextResponse.json(
        { error: 'Transaction ID and spent transaction ID are required' },
        { status: 400 }
      )
    }

    const likeTxid = String(txid).trim()
    const spendTxid = String(spent_txid).trim()
    if (
      likeTxid.length > 0 &&
      spendTxid.length > 0 &&
      likeTxid.toLowerCase() === spendTxid.toLowerCase()
    ) {
      return NextResponse.json(
        { error: 'spent_txid must be the transaction that spent the lock output, not the like txid' },
        { status: 400 }
      )
    }

    // Update the like as spent - only for the authenticated user
    const { data, error } = await supabase
      .from('likes')
      .update({ 
        is_spent: true, 
        spent_txid: spendTxid 
      })
      .eq('txid', likeTxid)
      .eq('user_id', user.id) // Only update likes belonging to authenticated user
      .select()

    if (error) {
      console.error('Error updating like as spent:', error)
      return NextResponse.json(
        { error: 'Failed to update like' },
        { status: 500 }
      )
    }

    if (!data || data.length === 0) {
      return NextResponse.json(
        { error: 'Like not found or not owned by user' },
        { status: 404 }
      )
    }

    return NextResponse.json({ 
      success: true, 
      data: data[0] 
    })

  } catch (error) {
    console.error('Failed to update spent like:', error)
    return NextResponse.json(
      { error: 'Failed to update like' },
      { status: 500 }
    )
  }
} 