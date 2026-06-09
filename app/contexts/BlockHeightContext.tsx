'use client'

import type React from 'react'
import { createContext, useContext } from 'react'
import { useBlockHeight } from '@/app/hooks/use-block-height'

type BlockHeightContextType = {
  blockHeight: number
  error: Error | null
  isLoading: boolean
}

const BlockHeightContext = createContext<BlockHeightContextType | undefined>(undefined)

export function BlockHeightProvider({ 
  children, 
  initialBlockHeight 
}: { 
  children: React.ReactNode
  initialBlockHeight?: number 
}) {
  const { blockHeight, error, isLoading } = useBlockHeight(initialBlockHeight)
  
  return (
    <BlockHeightContext.Provider value={{ blockHeight, error, isLoading }}>
      {children}
    </BlockHeightContext.Provider>
  )
}

export function useBlockHeightContext() {
  const context = useContext(BlockHeightContext)
  if (context === undefined) {
    throw new Error('useBlockHeightContext must be used within a BlockHeightProvider')
  }
  return context
}