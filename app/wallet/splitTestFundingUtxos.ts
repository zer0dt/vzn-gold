import { bsv } from 'scrypt-ts';
import { getPaymentUTXOs } from '@/app/lib/wallet-payment';

/** Matches typical mint funding needs in lockActions (`getPaymentUTXOs`). */
export const TEST_FUNDING_SATS_PER_OUTPUT = 25_000;
export const TEST_FUNDING_OUTPUT_COUNT = 100;

/** Extra headroom for miner fee on a ~100-output tx (sat/kb-style fees). */
export const TEST_FUNDING_FEE_HEADROOM_SATS = 80_000;

async function broadcastRawTx(txhex: string): Promise<string> {
  const response = await fetch('/api/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ txhex }),
  });

  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `Broadcast failed: ${response.status}`);
  }

  const { txid } = (await response.json()) as { txid: string };
  return txid;
}

/**
 * Splits wallet funds into many equal payment-address outputs for testing mint funding.
 * Uses session `walletAddress` / `walletKey` (same as send flow).
 */
export async function splitPaymentIntoTestFundingUtxos(options?: {
  satsPerOutput?: number;
  outputCount?: number;
}): Promise<{ txid: string; satsPerOutput: number; outputCount: number }> {
  const satsPerOutput = options?.satsPerOutput ?? TEST_FUNDING_SATS_PER_OUTPUT;
  const outputCount = options?.outputCount ?? TEST_FUNDING_OUTPUT_COUNT;

  if (typeof window === 'undefined') {
    throw new Error('splitPaymentIntoTestFundingUtxos is client-only');
  }

  const walletAddress = sessionStorage.getItem('walletAddress');
  const walletKey = sessionStorage.getItem('walletKey');

  if (!walletAddress || !walletKey) {
    throw new Error('Wallet not unlocked (missing session address or key)');
  }

  const totalOut = satsPerOutput * outputCount;
  const targetSpend = totalOut + TEST_FUNDING_FEE_HEADROOM_SATS;

  const utxos = await getPaymentUTXOs(walletAddress, targetSpend);
  if (!utxos.length) {
    throw new Error(
      `Insufficient UTXOs: need about ${targetSpend.toLocaleString()} sats (${outputCount} × ${satsPerOutput} + fee buffer)`
    );
  }

  const inputSum = utxos.reduce((s, u) => s + u.satoshis, 0);
  if (inputSum < totalOut + 1) {
    throw new Error(
      `Selected inputs sum to ${inputSum} sats; need at least ${totalOut} for outputs (plus fee)`
    );
  }

  const tx = new bsv.Transaction();
  tx.from(utxos);
  for (let i = 0; i < outputCount; i++) {
    tx.to(walletAddress, satsPerOutput);
  }
  tx.change(walletAddress);
  tx.feePerKb(500);

  tx.sign(bsv.PrivateKey.fromWIF(walletKey));

  const txid = await broadcastRawTx(tx.toString());
  return { txid, satsPerOutput, outputCount };
}
