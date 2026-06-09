/** Strip optional leading $ from API / env ticker values. */
export function tokenTickerBase(symbol: string): string {
  const t = symbol.trim()
  if (!t) return ''
  if (t.startsWith('$')) return t.slice(1).trim() || ''
  return t
}

/** Display form: exactly one leading $ when a base symbol exists. */
export function formatTokenTicker(symbol: string): string {
  const base = tokenTickerBase(symbol)
  if (!base) return ''
  return `$${base}`
}
