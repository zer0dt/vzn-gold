import {
  assert,
  bsv,
  DefaultProvider,
  method,
  prop,
  SmartContract,
  toByteString,
  Utils,
  type ByteString,
  Provider,
} from './scrypt-ts-facade';
import { Ordinal as ScryptOrdinal } from 'scrypt-ord/dist/contracts/ordinal';

export class Ordinal extends ScryptOrdinal {
  static int2Str(n: bigint): ByteString {
    assert(n < 18446744073709551616n, 'n is larger than 2^64-1');
    return toByteString(n.toString(), true);
  }
}

export class BSV20V2 extends SmartContract {
  @prop(true)
  id: ByteString;

  /** Max supply: max 2^64-1 */
  @prop()
  readonly max: bigint;

  /** Decimals: set decimal precision, defaults to 0. */
  @prop()
  readonly dec: bigint;

  @prop()
  readonly sym: ByteString;

  constructor(id: ByteString, sym: ByteString, max: bigint, dec: bigint) {
    super(id, sym, max, dec);
    this.id = id;
    this.sym = sym;
    this.max = max;
    this.dec = dec;
    assert(this.max <= 18446744073709551615n);
    assert(this.dec <= 18n);
  }

  @method()
  buildStateOutputFT(amt: bigint): ByteString {
    if (this.isGenesis()) {
      this.initId();
    }
    const stateScript =
      BSV20V2.createTransferInsciption(this.id, amt) +
      Ordinal.removeInsciption(this.getStateScript());
    return Utils.buildOutput(stateScript, 1n);
  }

  @method()
  isGenesis(): boolean {
    return this.id === toByteString('');
  }

  @method()
  initId(): void {
    this.id =
      Ordinal.txId2str(this.ctx.utxo.outpoint.txid) +
      toByteString('_', true) +
      Ordinal.int2Str(this.ctx.utxo.outpoint.outputIndex);
  }

  @method()
  static buildTransferOutput(address: ByteString, id: ByteString, amt: bigint): ByteString {
    return Utils.buildOutput(BSV20V2.buildTransferScript(address, id, amt), 1n);
  }

  @method()
  static buildTransferScript(address: ByteString, id: ByteString, amt: bigint): ByteString {
    return BSV20V2.createTransferInsciption(id, amt) + Utils.buildPublicKeyHashScript(address);
  }

  @method()
  static createTransferInsciption(id: ByteString, amt: bigint): ByteString {
    const amtByteString = Ordinal.int2Str(amt);
    const transferJSON =
      toByteString('{"p":"bsv-20","op":"transfer","id":"', true) +
      id +
      toByteString('","amt":"', true) +
      amtByteString +
      toByteString('"}', true);
    return Ordinal.createInsciption(transferJSON, toByteString('application/bsv-20', true));
  }

  static fromUTXO(utxo: { satoshis: number; script: string; txId?: string; outputIndex?: number }) {
    if (utxo.satoshis !== 1) {
      throw new Error('invalid ordinal bsv20 utxo');
    }
    const inscriptionScript = Ordinal.getInsciptionScript(utxo.script);
    if (!inscriptionScript) {
      throw new Error('invalid ordinal bsv20 utxo');
    }
    const nopScript = bsv.Script.fromHex(inscriptionScript);
    const instance = this.fromLockingScript(utxo.script, {}, nopScript);
    instance.from = utxo;
    return instance;
  }

  next(opt?: unknown) {
    const cloned = super.next(opt as never);
    cloned.prependNOPScript(this.getPrependNOPScript());
    return cloned;
  }
}

export class OrdiProvider extends Provider {
  private network: any;
  private provider: DefaultProvider;

  constructor(network?: any) {
    super();
    this.network = network || bsv.Networks.mainnet;
    this.provider = new DefaultProvider({ network: this.network });
  }

  isConnected(): boolean {
    return this.provider.isConnected();
  }

  async connect(): Promise<this> {
    await this.provider.connect();
    this.emit('connected', true);
    return this;
  }

  updateNetwork(network: any): void {
    this.network = network;
    this.provider.updateNetwork(network);
    this.emit('networkChange', network);
  }

  getNetwork(): any {
    return this.network;
  }

  sendRawTransaction(rawTxHex: string): Promise<string> {
    return this.provider.sendRawTransaction(rawTxHex);
  }

  listUnspent(address: InstanceType<typeof bsv.Address> | string, options?: unknown): Promise<unknown[]> {
    void options;
    return this.provider.listUnspent(address);
  }

  getBalance(address: InstanceType<typeof bsv.Address> | string): Promise<{ confirmed: number; unconfirmed: number }> {
    return this.provider.getBalance(address);
  }

  getTransaction(txHash: string): Promise<InstanceType<typeof bsv.Transaction>> {
    return this.provider.getTransaction(txHash);
  }

  getFeePerKb(): Promise<number> {
    return this.provider.getFeePerKb();
  }
}
