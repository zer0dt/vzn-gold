import { type NextRequest, NextResponse } from 'next/server';
import { BLOCK_HEIGHT_POLL_INTERVAL_MS } from '@/app/lib/block-height-poll';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const WOC_CHAIN_INFO =
  'https://api.whatsonchain.com/v1/bsv/main/chain/info';

type CachedChain = { height: number; fetchedAt: number };

let chainInfoCache: CachedChain | null = null;

function jsonResponse(height: number) {
  return NextResponse.json(
    { height, blockHeight: height, blocks: height },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
      },
    }
  );
}

export async function GET(request: NextRequest) {
  const fresh = request.nextUrl.searchParams.get('fresh') === '1';
  const now = Date.now();

  if (
    !fresh &&
    chainInfoCache &&
    now - chainInfoCache.fetchedAt < BLOCK_HEIGHT_POLL_INTERVAL_MS
  ) {
    return jsonResponse(chainInfoCache.height);
  }

  try {
    const response = await fetch(WOC_CHAIN_INFO, {
      cache: 'no-store',
    });
    if (!response.ok) {
      if (!fresh && response.status === 429 && chainInfoCache) {
        return jsonResponse(chainInfoCache.height);
      }
      throw new Error(`Upstream error: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    const height = typeof data?.blocks === 'number' ? data.blocks : 0;
    chainInfoCache = { height, fetchedAt: now };

    return jsonResponse(height);
  } catch (error) {
    console.error('Error fetching block height:', error);
    if (!fresh && chainInfoCache) {
      return jsonResponse(chainInfoCache.height);
    }
    return NextResponse.json(
      { error: 'Failed to fetch block height' },
      { status: 500 }
    );
  }
}