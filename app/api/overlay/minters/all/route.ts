import { GET as getMinters } from '../route'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  url.searchParams.set('all', 'true')
  return getMinters(new Request(url, request))
}
