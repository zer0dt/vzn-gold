import { PostSkeleton } from '@/app/components/PostSkeleton'

export default function Loading() {
  return (
    <div className="w-full max-w-2xl lg:mt-8 mt-8 mx-auto px-4 pb-8">
      <div className="h-7 w-40 bg-muted rounded animate-pulse mb-6" />
      <PostSkeleton />
    </div>
  )
}
