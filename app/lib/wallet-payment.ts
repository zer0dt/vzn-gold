import { bsv } from 'scrypt-ts';

const P2PKH_SIGSCRIPT_SIZE = 1 + 73 + 1 + 33;
// Estimated miner fee rate. Expressed in satoshis per kilobyte for historical reasons.
// 500 sat/kB equals 0.5 sat/byte, which meets common relay minimums on most BSV nodes.
const FEE_PER_KB = 500;

export const P2PKH_INPUT_SIZE = 36 + 1 + P2PKH_SIGSCRIPT_SIZE + 4;
export const FEE_FACTOR = FEE_PER_KB / 1000; // 0.5 sat/byte

const toOutpointKey = (txid: string, vout: number): string => `${txid}:${vout}`;

type WocUnspentRow = {
  value?: number;
  satoshis?: number;
  txid?: string;
  tx_hash?: string;
  vout?: number;
  tx_pos?: number;
  height?: number;
  block_height?: number;
  confirmations?: number;
  isSpentInMempoolTx?: boolean;
};

type NormalizedUtxo = {
  satoshis: number;
  txid: string;
  vout: number;
  confirmed: boolean;
  height: number | null;
  confirmations: number | null;
};

type PaymentUtxo = bsv.Transaction.IUnspentOutput & {
  confirmed?: boolean;
  height?: number | null;
  confirmations?: number | null;
};

const getUtxoHeight = (utxo: WocUnspentRow): number | null => {
  const height = utxo.height ?? utxo.block_height;
  return typeof height === 'number' && height > 0 ? height : null;
};

const getUtxoConfirmations = (utxo: WocUnspentRow): number | null => {
  return typeof utxo.confirmations === 'number' ? utxo.confirmations : null;
};

const isConfirmedUtxo = (utxo: WocUnspentRow): boolean => {
  const confirmations = getUtxoConfirmations(utxo);
  if (confirmations !== null) {
    return confirmations > 0;
  }

  return getUtxoHeight(utxo) !== null;
};

const normalizeUTXOs = (utxos: WocUnspentRow[]): NormalizedUtxo[] => {
  return utxos.map((utxo) => {
    return {
      satoshis: utxo?.value || utxo?.satoshis || 0,
      txid: utxo?.txid || utxo.tx_hash || '',
      vout: utxo.vout === undefined ? utxo.tx_pos ?? 0 : utxo.vout,
      confirmed: isConfirmedUtxo(utxo),
      height: getUtxoHeight(utxo),
      confirmations: getUtxoConfirmations(utxo),
    };
  });
};

const btUTXOs = async (address: string) => {
  if (!address) {
    console.error('btUTXOs called without a valid address.');
    throw new Error('Cannot fetch UTXOs without a valid address.');
  }
  console.log(`Calling WhatsOnChain UTXOs endpoint for address: ${address}`);
  const r = await fetch(
    `https://api.whatsonchain.com/v1/bsv/main/address/${address}/unspent/all`
  );

  if (!r.ok) {
    const errorText = await r.text();
    console.error(`WhatsOnChain API error (${r.status}) for address ${address}:`, errorText);
    throw new Error(`Failed to fetch UTXOs from WhatsOnChain (status: ${r.status})`);
  }

  const responseData = await r.json();
  const allUtxos: WocUnspentRow[] =
    responseData && Array.isArray(responseData.result) ? responseData.result : [];
  console.log(`Received ${allUtxos.length} total UTXOs from WOC for ${address}`);

  const availableUtxos = allUtxos.filter((utxo: WocUnspentRow) => {
    const isAvailable = !utxo.isSpentInMempoolTx;
    if (!isAvailable) {
      console.log(
        `Filtering out UTXO ${utxo.tx_hash}:${utxo.tx_pos} - already spent in mempool`
      );
    }
    return isAvailable;
  });

  console.log(
    `Filtered to ${availableUtxos.length} available UTXOs (${allUtxos.length - availableUtxos.length} filtered out as spent in mempool)`
  );

  return normalizeUTXOs(availableUtxos);
};

export const getPaymentUTXOs = async (
  address: string,
  amount: number,
  excludedOutpointKeys: string[] = []
): Promise<PaymentUtxo[]> => {
  const excluded = new Set(excludedOutpointKeys);
  const utxos = (await btUTXOs(address))
    .filter((utxo) => !excluded.has(toOutpointKey(utxo.txid, utxo.vout)))
    .sort((a, b) => {
      if (a.confirmed !== b.confirmed) return a.confirmed ? -1 : 1;
      return b.satoshis - a.satoshis;
    });
  const confirmedCount = utxos.filter((utxo) => utxo.confirmed).length;
  console.log(
    `[wallet-payment] Available funding UTXOs after exclusions: ${utxos.length} (${confirmedCount} confirmed, ${utxos.length - confirmedCount} unconfirmed)`
  );
  const scriptHex = bsv.Script.fromAddress(bsv.Address.fromString(address)).toHex();
  const toOutput = (u: NormalizedUtxo): PaymentUtxo => ({
    script: scriptHex,
    satoshis: u.satoshis,
    txId: u.txid,
    outputIndex: u.vout,
    confirmed: u.confirmed,
    height: u.height,
    confirmations: u.confirmations,
  });

  if (amount === 0) {
    return utxos.filter((u) => u.satoshis > 1).map(toOutput);
  }

  const minSingle = amount + 2;
  // Prefer the smallest UTXO that still covers `amount` (avoids spending a huge coin when
  // several smaller outputs — e.g. test splits — would suffice).
  const singleCoverCandidates = utxos.filter((u) => u.satoshis > 1 && u.satoshis >= minSingle);
  const smallestConfirmedCover = singleCoverCandidates
    .filter((u) => u.confirmed)
    .sort((a, b) => a.satoshis - b.satoshis)[0];
  const smallestCover =
    smallestConfirmedCover ?? singleCoverCandidates.sort((a, b) => a.satoshis - b.satoshis)[0];
  if (smallestCover) {
    console.log('[wallet-payment] Selected single funding UTXO', {
      txid: smallestCover.txid,
      vout: smallestCover.vout,
      satoshis: smallestCover.satoshis,
      confirmed: smallestCover.confirmed,
      height: smallestCover.height,
      confirmations: smallestCover.confirmations,
    });
    return [toOutput(smallestCover)];
  }

  let runningTotal = 0;
  const selected: typeof utxos = [];
  for (const u of utxos) {
    if (u.satoshis <= 1) continue;
    selected.push(u);
    runningTotal += u.satoshis;
    if (runningTotal >= amount) {
      console.log('[wallet-payment] Selected multiple funding UTXOs', {
        count: selected.length,
        totalSatoshis: runningTotal,
        confirmedCount: selected.filter((utxo) => utxo.confirmed).length,
        selected: selected.map((utxo) => ({
          txid: utxo.txid,
          vout: utxo.vout,
          satoshis: utxo.satoshis,
          confirmed: utxo.confirmed,
          height: utxo.height,
          confirmations: utxo.confirmations,
        })),
      });
      return selected.map(toOutput);
    }
  }
  return [];
};

export const getWalletBalance = async (address: string): Promise<number> => {
  if (!address) {
    console.error('getWalletBalance called without a valid address. Returning 0.');
    return 0;
  }
  try {
    console.log(`Fetching UTXOs via btUTXOs for balance of address: ${address}`);
    const utxos = await btUTXOs(address);
    const balance = utxos.reduce((acc, curr) => acc + (curr?.satoshis || 0), 0);
    console.log(`Calculated balance for ${address}: ${balance}`);
    return balance;
  } catch (error) {
    console.error(`Error calculating balance for ${address}:`, error);
    return 0;
  }
};

const broadcast = async (txhex: string) => {
  console.log('Broadcasting transaction:', txhex);

  try {
    const response = await fetch('/api/broadcast', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ txhex }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('Broadcast error:', error);
      throw new Error(`Broadcast failed: ${error.error}`);
    }

    const { txid } = await response.json();
    console.log('Transaction broadcasted successfully:', txid);

    return txid;
  } catch (error) {
    console.error('Failed to broadcast:', error);
    throw error;
  }
};

const payForRawTx = async (rawtx: string) => {
  const bsvtx = new bsv.Transaction(rawtx);
  const satoshis = bsvtx.outputs.reduce((t, e) => t + e.satoshis, 0);
  const txFee =
    parseInt(
      ((bsvtx.getEstimateSize() + P2PKH_INPUT_SIZE * bsvtx.inputs.length) * FEE_FACTOR).toString()
    ) + 1;
  const activeAddress = sessionStorage.getItem('walletAddress');
  if (!activeAddress) {
    throw 'Active wallet address not found in sessionStorage';
  }
  const utxos = await getPaymentUTXOs(activeAddress, satoshis + txFee);
  if (!utxos.length) {
    throw `Insufficient funds`;
  }
  bsvtx.from(utxos);
  const inputSatoshis = utxos.reduce((t, e) => t + e.satoshis, 0);
  if (inputSatoshis - satoshis - txFee > 0) {
    bsvtx.to(activeAddress, inputSatoshis - satoshis - txFee);
  }
  const activeWif = sessionStorage.getItem('walletKey');
  if (!activeWif) {
    throw 'Active wallet key not found in sessionStorage';
  }
  bsvtx.sign(bsv.PrivateKey.fromWIF(activeWif));
  console.log(bsvtx.toString());
  return bsvtx.toString();
};

export const sendBSV = async (satoshis: number, toAddress: string, fromAddress: string) => {
  try {
    if (!satoshis) {
      throw `Invalid amount`;
    }
    const balance = await getWalletBalance(fromAddress);
    if (balance < satoshis) throw `Amount entered exceeds balance`;
    const sendMax = balance === satoshis;
    if (!toAddress) {
      throw `Invalid address`;
    }

    const addr = bsv.Address.fromString(toAddress);
    if (addr) {
      const bsvtx = new bsv.Transaction();
      if (sendMax) {
        bsvtx.to(addr, satoshis - 10);
      } else {
        bsvtx.to(addr, satoshis);
      }
      const rawtx = await payForRawTx(bsvtx.toString());
      if (rawtx) {
        const t = await broadcast(rawtx);
        return t;
      }
    }
  } catch (e) {
    console.log(e);
    throw e;
  }
};

export const newPK = () => {
  const pk = new bsv.PrivateKey();
  const pkWIF = pk.toWIF();
  return pkWIF;
};

export const restoreWallet = (oPK: string, pPk: string) => {
  const pk = bsv.PrivateKey.fromWIF(pPk);
  const pkWif = pk.toString();
  const address = bsv.Address.fromPrivateKey(pk);
  const ownerPk = bsv.PrivateKey.fromWIF(oPK);
  sessionStorage.setItem('ownerKey', ownerPk.toWIF());
  const ownerAddress = bsv.Address.fromPrivateKey(ownerPk);
  sessionStorage.setItem('ownerAddress', ownerAddress.toString());
  sessionStorage.setItem('walletAddress', address.toString());
  sessionStorage.setItem('walletKey', pkWif);
  sessionStorage.setItem('ownerPublicKey', ownerPk.toPublicKey().toHex());
};
