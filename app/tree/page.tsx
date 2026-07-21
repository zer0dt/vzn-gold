import type { Metadata } from 'next'

import TreePageClient from './TreePageClient'

export const metadata: Metadata = {
  title: '$VZN LockLikeMintBSV21Parallel (LLM21) Tree | VZN.gold',
  description: 'Explore the $VZN minter output tree.',
}

export default function MintTreePage() {
  const originId = process.env.NEXT_PUBLIC_LLM21_ORIGIN_ID?.trim() ?? ''
  return <TreePageClient originId={originId} />
}
