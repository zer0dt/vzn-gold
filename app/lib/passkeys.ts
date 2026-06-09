// Client-side passkeys in this app protect locally stored convenience secrets.
// They improve resistance to casual storage theft, but they are not a substitute
// for a server-verified authentication boundary.

export * from './passkey-storage'
export * from './passkey-temp-secret'
