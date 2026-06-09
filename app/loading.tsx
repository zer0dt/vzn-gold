import { Loader2 } from "lucide-react"

export default function Loading() {
  return (
    <div className="flex items-center justify-center h-[calc(100vh-48px)]">
      <Loader2 className="h-6 w-6 animate-spin text-primary/70" />
    </div>
  )
} 