import { useQuery } from '@tanstack/react-query'

type ExchangeRateResponse = {
  currency: string
  rate: string
  time: number
}

async function fetchBSVPrice() {
  const response = await fetch('https://api.whatsonchain.com/v1/bsv/main/exchangerate')
  if (!response.ok) {
    throw new Error('Failed to fetch BSV price')
  }
  const data: ExchangeRateResponse = await response.json()
  return parseFloat(data.rate)
}

export function useBSVPrice() {
  const { 
    data: bsvPrice = 0, 
    isError,
    isLoading 
  } = useQuery({
    queryKey: ['bsv-price'],
    queryFn: fetchBSVPrice,
    refetchInterval: 180000, // Refresh every 3 minutes (increased from 1 min)
    staleTime: 60000, // Consider data fresh for 1 minutes (increased from 30s)
    gcTime: 360000, // Keep in cache for 6 minutes
    refetchOnWindowFocus: true, // Optional: prevent refetch on window focus if not needed
    retry: 3
  })

  return { bsvPrice, isError, isLoading }
}