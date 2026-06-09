/**
 * BSV21 `op` values for token amounts still held on lock/minter outputs (vout 0/1, no payee `address`).
 * `deploy+mint` is the genesis minter UTXO; later states often use `transfer` (and `mint` when applicable).
 */
export const BSV21_MINTER_POOL_OPS = new Set(['transfer', 'deploy+mint', 'mint'])

export function isBsv21MinterPoolOp(op: string | undefined): boolean {
  return typeof op === 'string' && BSV21_MINTER_POOL_OPS.has(op)
}
