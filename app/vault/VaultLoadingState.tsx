'use client'

import { Loader2 } from 'lucide-react'

export default function VaultLoadingState({
  message = 'Loading your vault...',
}: {
  message?: string
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-4">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  )
}
