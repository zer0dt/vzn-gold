import { bsv } from 'scrypt-ts/dist/smart-contract/bsv/index';
import { Provider } from 'scrypt-ts/dist/bsv/abstract-provider';

export { prop, method } from 'scrypt-ts/dist/smart-contract/decorators';
export { SmartContract } from 'scrypt-ts/dist/smart-contract/contract';
export { SmartContractLib } from 'scrypt-ts/dist/smart-contract/library';
export { P2PKH } from 'scrypt-ts/dist/smart-contract/builtins/p2pkh';
export { P2PK } from 'scrypt-ts/dist/smart-contract/builtins/p2pk';
export * from 'scrypt-ts/dist/smart-contract/builtins/types';
export * from 'scrypt-ts/dist/smart-contract/builtins/functions';
export * from 'scrypt-ts/dist/bsv/utils';
export * from 'scrypt-ts/dist/smart-contract/utils';
export {
  toHex,
  buildPublicKeyHashScript,
  buildOpreturnScript,
  FunctionCall,
} from 'scryptlib';
export { bsv };
export * from 'scrypt-ts/dist/bsv/types';
export * from 'scrypt-ts/dist/smart-contract/types/index';
export * from 'scrypt-ts/dist/smart-contract/utils/index';
export { Provider };
export * from 'scrypt-ts/dist/bsv/abstract-signer';
export { TestWallet } from 'scrypt-ts/dist/bsv/wallets/test-wallet';

export class DefaultProvider extends Provider {
  private network: any;

  constructor(options?: { network?: any }) {
    super();
    this.network = options?.network || bsv.Networks.mainnet;
  }

  isConnected(): boolean {
    return true;
  }

  connect(): Promise<this> {
    return Promise.resolve(this);
  }

  updateNetwork(network: any): void {
    this.network = network;
  }

  getNetwork(): any {
    return this.network;
  }

  getFeePerKb(): Promise<number> {
    return Promise.resolve(100);
  }

  async sendRawTransaction(rawTxHex: string): Promise<string> {
    const response = await fetch('/api/broadcast', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txhex: rawTxHex }),
    });

    if (!response.ok) {
      throw new Error(`Broadcast failed: ${response.status} ${response.statusText}`);
    }

    const result = (await response.json()) as { txid?: string };
    if (!result.txid) {
      throw new Error('Broadcast response did not include a txid');
    }

    return result.txid;
  }

  async listUnspent(
    address: InstanceType<typeof bsv.Address>,
    options?: unknown
  ): Promise<bsv.Transaction.IUnspentOutput[]> {
    void options;
    const addressString = address.toString();
    const response = await fetch(
      `https://api.whatsonchain.com/v1/bsv/main/address/${addressString}/unspent/all`
    );

    if (!response.ok) {
      return [];
    }

    const data = (await response.json()) as {
      result?: Array<{ tx_hash?: string; txid?: string; tx_pos?: number; vout?: number; value?: number }>;
    };

    return (data.result || []).map((utxo) => ({
      txId: utxo.txid || utxo.tx_hash || '',
      outputIndex: utxo.vout ?? utxo.tx_pos ?? 0,
      satoshis: utxo.value || 0,
    })) as bsv.Transaction.IUnspentOutput[];
  }

  async getBalance(address?: InstanceType<typeof bsv.Address>): Promise<{ confirmed: number; unconfirmed: number }> {
    if (!address) {
      return { confirmed: 0, unconfirmed: 0 };
    }

    const utxos = (await this.listUnspent(address)) as Array<{ satoshis?: number }>;
    return {
      confirmed: utxos.reduce((total, utxo) => total + (utxo.satoshis || 0), 0),
      unconfirmed: 0,
    };
  }

  async getTransaction(txHash: string): Promise<InstanceType<typeof bsv.Transaction>> {
    const response = await fetch(`https://api.whatsonchain.com/v1/bsv/main/tx/${txHash}/hex`);
    if (!response.ok) {
      throw new Error(`Failed to fetch transaction: ${response.status} ${response.statusText}`);
    }
    return new bsv.Transaction(await response.text());
  }
}
