import { Skeleton } from "@/app/components/ui/skeleton"

interface PostSkeletonProps {
  delayMs?: number
}

export function PostSkeleton({ delayMs = 0 }: PostSkeletonProps) {
  const style = delayMs
    ? ({ animationDelay: `${delayMs}ms` } as React.CSSProperties)
    : undefined

  return (
    <article className="px-4 font-post-sans" style={style}>
      <div className="relative flex gap-3 pt-3 pb-1 border-b border-border/60">
        {/* Avatar — matches h-10 w-10 ring-1 in real Post */}
        <Skeleton className="h-10 w-10 shrink-0 rounded-full ring-1 ring-border/60" />

        {/* Right column — mirrors PostHeader + PostContent + PostActions */}
        <div className="min-w-0 flex-1">
          {/* PostHeader: left = username · timestamp, right = short txid pill */}
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2 min-w-0">
              <Skeleton className="h-[14px] w-28 rounded-full" />
              <span className="text-sm text-muted-foreground/40">·</span>
              <Skeleton className="h-3 w-16 rounded-full" />
            </div>
            <Skeleton className="h-6 w-[92px] rounded-md shrink-0" />
          </div>

          {/* PostContent: ~3 lines of text at leading-6 */}
          <div className="mt-2 space-y-2">
            <Skeleton className="h-[15px] w-full rounded-full" />
            <Skeleton className="h-[15px] w-[92%] rounded-full" />
            <Skeleton className="h-[15px] w-[60%] rounded-full" />
          </div>

          {/* PostActions: mt-1 justify-between pr-6; left / centered middle / right */}
          <div className="mt-3 flex items-center justify-between pr-6">
            {/* Left — comments */}
            <div className="flex items-center gap-1 min-w-[48px]">
              <Skeleton className="h-6 w-6 rounded-full" />
              <Skeleton className="h-3 w-14 rounded-full" />
            </div>

            {/* Middle — like + sats, centered */}
            <div className="flex-1 flex items-center justify-center">
              <div className="flex items-center gap-1">
                <Skeleton className="h-6 w-6 rounded-full" />
                <Skeleton className="h-3 w-16 rounded-full" />
              </div>
            </div>

            {/* Right — copy link */}
            <div className="flex items-center justify-end min-w-[48px]">
              <Skeleton className="h-6 w-6 rounded-full" />
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}
