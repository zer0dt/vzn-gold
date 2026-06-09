'use client'

import { useCallback } from 'react'
import { useBSVPrice } from '@/app/hooks/use-bsv-price'
import { TradeTabContent } from '@/app/components/trade/TradeTabContent'

export default function TradePageClient() {
  const { bsvPrice } = useBSVPrice()

  const calculateUSDValue = useCallback(
    (sats: number) => {
      if (!bsvPrice || bsvPrice === 0) return 0
      return (sats / 100000000) * bsvPrice
    },
    [bsvPrice]
  )

  return (
    <TradeTabContent
      calculateUSDValue={calculateUSDValue}
      bsvPrice={bsvPrice}
    />
  )
}
