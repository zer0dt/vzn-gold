import { PostSkeleton } from "./PostSkeleton"

function FeedTabsSkeleton() {
  return (
    <>
      {/* Mobile floating tabs — mirrors Feed.tsx mobile header */}
      <div className="fixed top-2 left-1/2 transform -translate-x-1/2 z-40 block lg:hidden w-full px-3 pointer-events-none">
        <div className="w-full">
          <div className="w-fit max-w-[calc(100vw-2rem)] mx-auto px-4 py-0.5 bg-transparent border-0 rounded-none shadow-none pointer-events-auto">
            <div className="flex flex-col items-center space-y-1">
              <div
                role="tablist"
                aria-hidden
                className="flex gap-1 rounded-full border border-border/60 bg-background/60 p-1 backdrop-blur"
              >
                <span className="relative rounded-full px-4 py-1.5 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground bg-amber-400/15 text-amber-600 dark:text-amber-300 select-none">
                  New
                </span>
                <span className="rounded-full px-4 py-1.5 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground select-none">
                  Top
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Desktop sticky tabs — mirrors Feed.tsx desktop header */}
      <div className="sticky top-0 z-40 hidden lg:block bg-slate-100/80 dark:bg-background/80 backdrop-blur-lg border-b border-border/50">
        <div className="flex flex-col px-3 pt-3 pb-2 sm:px-4 space-y-1 max-w-4xl mx-auto">
          <div
            role="tablist"
            aria-hidden
            className="mx-auto grid w-full max-w-[420px] grid-cols-2 rounded-full border border-border/60 bg-background/60 p-1 backdrop-blur"
          >
            <span className="inline-flex items-center justify-center rounded-full py-1.5 text-xs font-medium uppercase tracking-[0.12em] bg-amber-400/15 text-amber-600 dark:text-amber-300 select-none">
              New
            </span>
            <span className="inline-flex items-center justify-center rounded-full py-1.5 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground select-none">
              Top
            </span>
          </div>
        </div>
      </div>
    </>
  )
}

export default function FeedSkeleton() {
  return (
    <div className="relative lg:pt-0 -mt-2 bg-transparent">
      <FeedTabsSkeleton />

      <div className="relative z-30 h-dvh overflow-hidden pb-16 lg:h-screen lg:pb-0 pt-14 lg:pt-0 mb-0 scrollbar-hide">
        {Array.from({ length: 9 }).map((_, i) => (
          <PostSkeleton key={i} delayMs={i * 100} />
        ))}
      </div>
    </div>
  )
}
