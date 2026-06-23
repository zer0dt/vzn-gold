import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const postTxid = searchParams.get('post_txid')
    const userId = searchParams.get('user_id')
    const withProfiles = searchParams.get('with_profiles') === 'true'
    const page = parseInt(searchParams.get('page') || '0', 10)
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    const offset = page * limit

    if (!postTxid && !userId) {
      console.warn('GET /api/replies - Missing post_txid or user_id in request')
      return NextResponse.json({ error: 'Missing post_txid or user_id' }, { status: 400 })
    }

    const supabase = await createClient()

    let selectClause = '*'
    if (withProfiles) {
      selectClause += ', profile:profiles!replies_user_id_fkey(username, avatar_url)'
    }

    // Build single query with count and pagination
    let query = supabase
      .from('replies')
      .select(selectClause, { count: 'exact' })

    // Handle post-specific query
    if (postTxid) {
      query = query.eq('post_txid', postTxid)
    }

    // Handle user-specific query
    if (userId) {
      query = query.eq('user_id', userId)
    }

    // Execute single query with ordering and pagination
    const { data: replies, count, error } = await query
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('GET /api/replies - Supabase error:', {
        error,
        postTxid,
        userId,
        timestamp: new Date().toISOString()
      })
      throw error
    }

    const totalCount = count || 0
    const hasMore = totalCount > offset + (replies?.length || 0)

    return NextResponse.json({
      replies: replies || [],
      hasMore,
      totalCount
    })
  } catch (error) {
    console.error('GET /api/replies - Unexpected error:', {
      error,
      stack: (error as Error).stack,
      timestamp: new Date().toISOString()
    })
    return NextResponse.json(
      {
        error: 'Failed to fetch replies',
        replies: [],
        hasMore: false,
        totalCount: 0
      },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    const { txid, post_txid, user_id, content, has_image } = await request.json()
    const finalContent = typeof content === 'string' ? content.trim() : ''
    const hasImage = Boolean(has_image)

    if (!txid || !post_txid || !user_id || (!finalContent && !hasImage)) {
      console.warn('POST /api/replies - Missing required fields:', {
        txid: !!txid,
        post_txid: !!post_txid,
        user_id: !!user_id,
        content: !!finalContent,
        has_image: hasImage
      })
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()

    if (authError || !user) {
      console.error('Authentication failed:', authError)
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      )
    }

    // Verify that the authenticated user matches the user_id
    if (user.id !== user_id) {
      console.error('Authorization failed: user.id !== user_id:', {
        userId: user.id,
        requestUserId: user_id
      })
      return NextResponse.json(
        { error: 'Unauthorized: user_id does not match authenticated user' },
        { status: 403 }
      )
    }

    const { data, error: replyError } = await supabase
      .from('replies')
      .insert([
        {
          txid,
          post_txid,
          user_id,
          content: finalContent,
          has_image: hasImage
        }
      ])
      .select(`
        *,
        profile:profiles!replies_user_id_fkey(username, avatar_url)
      `)
      .single()

    if (replyError) {
      console.error('Database insert failed:', replyError)
      throw replyError
    }

    return NextResponse.json({ success: true, data }, { status: 201 })
  } catch (error) {
    console.error('Failed to create reply:', error)
    return NextResponse.json(
      { error: 'Failed to create reply' },
      { status: 500 }
    )
  }
}