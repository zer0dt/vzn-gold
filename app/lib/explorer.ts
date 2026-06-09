/** Browser URL base for a transaction on Whatsonchain (not the REST API host). */
export const WOC_TX_PAGE_BASE = "https://whatsonchain.com/tx" as const;

export const WOC_ADDRESS_PAGE_BASE =
  "https://whatsonchain.com/address" as const;

export function wocTxUrl(txid: string): string {
  return `${WOC_TX_PAGE_BASE}/${txid}`;
}

export function wocAddressUrl(address: string): string {
  return `${WOC_ADDRESS_PAGE_BASE}/${address}`;
}
