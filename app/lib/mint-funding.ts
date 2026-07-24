/**
 * Extra sats funding inputs must cover beyond (outputs − contract UTXO).
 * Pays miner fee for ~150 KB mint txs at 150 sat/KB plus ARC relay floor.
 * Keep in sync with mint selection in lockActions / mint-prefetch.
 */
export const MINT_FUNDING_INPUT_HEADROOM_SATS = 25_000;

export const MAX_MINT_FUNDING_SPLIT_COUNT = 50;

/** Matches wallet-payment fee model (500 sat/kB ≈ 0.5 sat/byte) for UI estimates. */
const P2PKH_INPUT_SIZE = 36 + 1 + (1 + 73 + 1 + 33) + 4;
const P2PKH_OUTPUT_SIZE = 34;
const TX_OVERHEAD_SIZE = 10;
const FEE_FACTOR = 0.5;

/** Satoshis per mint-ready payment UTXO the wallet should prefer. */
export function mintFundingOutputSatoshis(contractSats: number): number {
  if (!Number.isFinite(contractSats) || contractSats <= 0) {
    throw new Error('Invalid contract lock amount');
  }
  return Math.trunc(contractSats) + MINT_FUNDING_INPUT_HEADROOM_SATS;
}

export function estimateMintFundingSplitFeeSats(
  inputCount: number,
  outputCount: number
): number {
  const size =
    TX_OVERHEAD_SIZE +
    inputCount * P2PKH_INPUT_SIZE +
    outputCount * P2PKH_OUTPUT_SIZE;
  return Math.ceil(size * FEE_FACTOR) + 1;
}

export function maxMintFundingSplitCount(
  balanceSats: number,
  outputSatoshis: number,
  assumedInputCount = 1
): number {
  if (balanceSats <= 0 || outputSatoshis <= 0) {
    return 0;
  }
  for (let count = MAX_MINT_FUNDING_SPLIT_COUNT; count >= 1; count -= 1) {
    const fee = estimateMintFundingSplitFeeSats(assumedInputCount, count + 1);
    if (balanceSats >= outputSatoshis * count + fee) {
      return count;
    }
  }
  return 0;
}
