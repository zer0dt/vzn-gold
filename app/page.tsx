import { Suspense } from "react"
import Feed from "@/app/components/Feed"
import FeedSkeleton from "@/app/components/FeedSkeleton"

export default async function Home() {
  return (
    <div className="max-w-2xl mx-auto py-0 sm:py-0">
      <Suspense fallback={<FeedSkeleton />}>
        <Feed />
      </Suspense>
    </div>
  )
}
