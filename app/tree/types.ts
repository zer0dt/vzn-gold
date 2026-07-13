export type MinterOutput = {
  id: string
  txid: string
  outputIndex: number
  amount: string
  depth: number
  status: 'live' | 'spent'
  spendTxid: string | null
  parentId: string | null
  childIds: string[]
}

export type MintTransaction = {
  txid: string
  kind: 'genesis' | 'mint'
  depth: number
  parentOutputId: string | null
  childOutputIds: string[]
}

export type BranchLike = {
  likeTxid: string
  postTxid: string
  userId: string
  satsAmount: number
}

export type MintTreeResponse = {
  originId: string
  rootId: string
  outputs: MinterOutput[]
  transactions: MintTransaction[]
  likesByBranchId: Record<string, BranchLike[]>
  stats: {
    outputCount: number
    transactionCount: number
    liveOutputCount: number
    spentOutputCount: number
    likedBranchCount: number
    maxDepth: number
  }
}
