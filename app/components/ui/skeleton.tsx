import { cn } from "@/app/lib/utils"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-md bg-gradient-to-r from-foreground/[0.05] via-foreground/[0.12] to-foreground/[0.05] animate-gradient-x",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
