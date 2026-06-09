import { createClient } from '@/utils/supabase/server'
import { NextResponse } from 'next/server'

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const ownerPublicKey = searchParams.get('owner_public_key')
    
    const supabase = await createClient()

    let query = supabase
      .from('posts')
      .select('*')
      .order('created_at', { ascending: false })

    if (ownerPublicKey) {
      query = query.eq('owner_public_key', ownerPublicKey)
    }

    const { data, error } = await query

    if (error) throw error
    return NextResponse.json(data)
  } catch (error) {
    console.error('Failed to fetch posts:', error)
    return NextResponse.json(
      { error: 'Failed to fetch posts' },
      { status: 500 }
    )
  }
}

export async function POST(request: Request) {
  try {
    // Get Supabase client and check auth
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      console.error('Auth error:', authError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get data from request body
    const { content, txid, has_image } = await request.json();

    // Validate required fields (optional but good practice)
    if (!txid) {
        return NextResponse.json({ error: 'Missing required field: txid' }, { status: 400 });
    }
     // content can be empty if there's an image, has_image defaults to false

    const { data, error } = await supabase
      .from('posts')
      .insert({
        content,        // Content from request
        txid,           // txid from request
        has_image,      // has_image from request (will be boolean)
        user_id: user.id // Use the authenticated user's ID
      })
      .select()
      .single();

    if (error) {
        console.error('Supabase insert error:', error);
        // Provide more specific feedback if possible, e.g., check for duplicate txid
        if (error.code === '23505') { // Handle potential unique constraint violation (e.g., duplicate txid)
            return NextResponse.json({ error: 'Post with this txid already exists.' }, { status: 409 });
        }
        throw error; // Rethrow for generic error handling
    }
    
    return NextResponse.json(data);
  } catch (error) {
    // Ensure error is logged appropriately
    console.error('Failed to create post:', error);
    // Avoid exposing detailed internal errors to the client unless necessary
    const message = error instanceof Error ? error.message : 'Failed to create post';
    return NextResponse.json({ error: message }, { status: 500 });
  }
} 