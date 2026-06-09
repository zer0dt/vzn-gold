
  interface Window {
    bsv?: unknown;
    localStorage: {
      walletAddress: string;
      walletKey: string;
      ownerKey: string;
      ownerAddress: string;
      ownerPublicKey: string;
    } & Storage;
  }

  declare module 'wif' {
    export function decode(key: string): { version: number; privateKey: Buffer; compressed: boolean };
    export function encode(version: number, privateKey: Buffer, compressed: boolean): string;
  }

