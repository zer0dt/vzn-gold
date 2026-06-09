import { useQuery } from '@tanstack/react-query'

type VznContractConfigResponse = {
  originId?: string
  sats?: number
  blocks?: number
}

type StoredVznContractConfig = Required<VznContractConfigResponse>

const STORAGE_KEY_PREFIX = 'vzn-contract-config:'

function getStorageKey(originId: string) {
  return `${STORAGE_KEY_PREFIX}${originId}`
}

function readStoredContractConfig(originId: string): StoredVznContractConfig | undefined {
  if (typeof window === 'undefined') {
    return undefined
  }

  try {
    const raw = window.localStorage.getItem(getStorageKey(originId))
    if (!raw) {
      return undefined
    }

    const parsed = JSON.parse(raw) as VznContractConfigResponse
    if (
      parsed.originId === originId &&
      typeof parsed.sats === 'number' &&
      typeof parsed.blocks === 'number'
    ) {
      return {
        originId,
        sats: parsed.sats,
        blocks: parsed.blocks,
      }
    }
  } catch {
    // Ignore malformed local cache entries.
  }

  return undefined
}

function writeStoredContractConfig(config: StoredVznContractConfig) {
  if (typeof window === 'undefined') {
    return
  }

  try {
    window.localStorage.setItem(getStorageKey(config.originId), JSON.stringify(config))
  } catch {
    // Ignore storage failures.
  }
}

async function fetchVznContractConfig(): Promise<Required<VznContractConfigResponse>> {
  const response = await fetch('/api/vzn/token-info', { cache: 'no-store' })
  if (!response.ok) {
    throw new Error('Failed to fetch VZN contract config')
  }

  const data = (await response.json()) as VznContractConfigResponse
  if (
    typeof data.originId !== 'string' ||
    typeof data.sats !== 'number' ||
    typeof data.blocks !== 'number'
  ) {
    throw new Error('VZN contract config is incomplete')
  }

  const config = {
    originId: data.originId,
    sats: data.sats,
    blocks: data.blocks,
  }

  writeStoredContractConfig(config)
  return config
}

export function useVznContractConfig(enabled = true) {
  const originId = process.env.NEXT_PUBLIC_LLM21_ORIGIN_ID ?? 'unknown'
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['vzn-contract-config', originId],
    queryFn: fetchVznContractConfig,
    initialData: () => readStoredContractConfig(originId),
    enabled,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: 2,
  })

  return {
    contractSats: data?.sats ?? null,
    contractBlocks: data?.blocks ?? null,
    isLoading,
    isError,
    error,
  }
}
