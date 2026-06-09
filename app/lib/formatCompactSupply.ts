/** Compact token supply display (matches NetworkStatsPanel / minted UI). */
export function formatCompactSupply(value: number): string {
  if (value >= 1_000_000_000) {
    return `${parseFloat((value / 1_000_000_000).toFixed(1))}B`
  }

  if (value >= 1_000_000) {
    return `${parseFloat((value / 1_000_000).toFixed(1))}M`
  }

  return value.toLocaleString()
}
