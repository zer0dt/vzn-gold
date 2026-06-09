import { ImageResponse } from 'next/og'
import { createClient } from '@/utils/supabase/server'

export async function GET(request: Request, props: { params: Promise<{ txid: string }> }) {
  const params = await props.params;
  try {
    const supabase = await createClient()
    
    const { data: post } = await supabase
      .from('posts')
      .select('*')
      .eq('txid', params.txid)
      .single()

    if (!post) {
      return new Response('Not found', { status: 404 })
    }

    const contentSnippet = post.content?.substring(0, 150) + (post.content?.length > 150 ? '...' : '')

    return new ImageResponse(
      (
        <div
          style={{
            background: 'linear-gradient(to bottom right, #f97316, #fbbf24)',
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px',
          }}
        >
          <div
            style={{
              background: 'rgba(0, 0, 0, 0.7)',
              padding: '20px',
              borderRadius: '10px',
              maxWidth: '80%',
              textAlign: 'center',
            }}
          >
            <p
              style={{
                fontSize: '32px',
                color: 'white',
                fontFamily: 'Inter',
                lineHeight: '1.4',
              }}
            >
              {contentSnippet}
            </p>
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
      }
    )
  } catch (e) {
    console.error(e)
    return new Response('Error', { status: 500 })
  }
} 