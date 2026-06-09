import { NextResponse } from 'next/server';

const GORILLA_POOL_MARKET_SALES_API = 'https://ordinals.gorillapool.io/api/bsv20/market/sales';
const CACHE_S_MAXAGE_SECONDS = 20;
const CACHE_STALE_WHILE_REVALIDATE_SECONDS = 120;

export async function GET() {
  try {
    const tokenId = process.env.NEXT_PUBLIC_LLM21_ORIGIN_ID;
    if (!tokenId) {
      return NextResponse.json(
        { error: 'Token ID not configured' },
        { status: 500 }
      );
    }

    const url = `${GORILLA_POOL_MARKET_SALES_API}?limit=100&offset=0&type=all&id=${encodeURIComponent(tokenId)}&pending=true`;
    const upstreamResponse = await fetch(url, {
      // Cache at the Next.js data cache layer and revalidate in the background.
      next: { revalidate: CACHE_S_MAXAGE_SECONDS }
    });

    if (!upstreamResponse.ok) {
      if (upstreamResponse.status === 404) {
        return NextResponse.json([], {
          headers: {
            'Cache-Control': `public, s-maxage=${CACHE_S_MAXAGE_SECONDS}, stale-while-revalidate=${CACHE_STALE_WHILE_REVALIDATE_SECONDS}`
          }
        });
      }

      return NextResponse.json(
        { error: 'Failed to fetch VZN sales history', status: upstreamResponse.status },
        { status: 502 }
      );
    }

    const data = await upstreamResponse.json();

    return NextResponse.json(data, {
      headers: {
        'Cache-Control': `public, s-maxage=${CACHE_S_MAXAGE_SECONDS}, stale-while-revalidate=${CACHE_STALE_WHILE_REVALIDATE_SECONDS}`
      }
    });
  } catch (error) {
    console.error('Error fetching VZN sales history:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
