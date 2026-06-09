import { NextResponse } from 'next/server';
import ogs from 'open-graph-scraper';
import { cache } from 'react';

// Add caching for OG data
const getOgData = cache(async (url: string) => {
  const { result } = await ogs({ 
    url,
    fetchOptions: {
      headers: {
        'accept-language': 'en-US'
      }
    },
    onlyGetOpenGraphInfo: true
  });
  
  return {
    title: result.ogTitle || result.twitterTitle || '',
    description: result.ogDescription || result.twitterDescription || '',
    image: result.ogImage?.[0]?.url || result.twitterImage?.[0]?.url || '',
    site: result.ogSiteName || '',
    url: url
  };
});

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get('url');

  if (!url) {
    return NextResponse.json({ error: 'Missing URL parameter' }, { status: 400 });
  }

  try {
    const data = await getOgData(url);
    // Add cache headers to the response
    return NextResponse.json(data, {
      headers: {
        'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400',
        'CDN-Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('Error fetching OG data:', error);
    // Return a more graceful fallback
    return NextResponse.json({
      title: '',
      description: '',
      image: '',
      site: new URL(url).hostname,
      url: url
    });
  }
} 