import { Loader2 } from 'lucide-react'

export default function Loading() {
  return (
    <div className="w-full max-w-2xl lg:mt-8 mt-8 mx-auto px-4 pb-24 lg:pb-8">
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-amber-500 dark:text-amber-400" />
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">Loading trade…</p>
      </div>
    </div>
  )
}
