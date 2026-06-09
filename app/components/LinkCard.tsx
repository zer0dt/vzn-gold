'use client'

import { useQuery } from '@tanstack/react-query'
import { cn } from '@/app/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'

interface LinkCardProps {
  href: string
  children: React.ReactNode
  className?: string
}

const fetchOgData = async (url: string) => {
  const res = await fetch(`/api/og?url=${encodeURIComponent(url)}`)
  if (!res.ok) throw new Error('Failed to fetch OG data')
  return res.json()
}

export default function LinkCard({ href, children, className }: LinkCardProps) {
  const isInternalLink = !href || href.startsWith('#') || href.startsWith('/')
  const hostname = !isInternalLink ? new URL(href).hostname.replace('www.', '') : ''

  const { data, isLoading } = useQuery({
    queryKey: ['ogData', href],
    queryFn: () => fetchOgData(href),
    staleTime: 1000 * 60 * 60,
    enabled: !isInternalLink,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    retry: 1,
    placeholderData: {
      title: children?.toString() || '',
      description: '',
      image: '',
      site: hostname,
      url: href
    }
  })

  const BasicLink = () => (
    <motion.a
      key="basic"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "block border rounded-lg hover:border-primary/30 no-underline transition-colors overflow-hidden",
        className
      )}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="p-4">
        <div className="font-medium text-foreground text-lg">{children}</div>
        <div className="text-xs text-muted-foreground mt-3 text-right">{hostname}</div>
      </div>
    </motion.a>
  )

  if (isInternalLink) {
    return <a href={href} className="text-primary hover:underline">{children}</a>
  }

  const isOgReady = !!data?.title;

  return (
    <AnimatePresence mode="wait">
      {!isOgReady ? (
        <BasicLink />
      ) : (
        <motion.a
          key="og"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            "block border rounded-lg hover:border-primary/30 no-underline transition-colors overflow-hidden",
            className
          )}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3 }}
        >
          <div className="p-4">
            <div className="font-medium text-foreground text-lg">{data.title}</div>
            {data.description && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                transition={{ duration: 0.3, delay: 0.15 }}
                className="text-sm text-muted-foreground line-clamp-2 mt-2 overflow-hidden"
              >
                {data.description}
              </motion.div>
            )}
            <div className="text-xs text-muted-foreground mt-3 text-right">{hostname}</div>
          </div>
        </motion.a>
      )}
    </AnimatePresence>
  )
} 