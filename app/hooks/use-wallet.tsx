'use client'

import type React from 'react';
import {
  createContext,
  useState,
  useEffect,
  useContext,
  useCallback,
  type ReactNode,
} from 'react'
import { useToast } from '@/app/hooks/use-toast';
import { useBSVPrice } from '@/app/hooks/use-bsv-price';
import { useAuth } from '@/app/contexts/AuthContext';
import {
  isPasskeyAvailable,
} from '@/app/lib/passkeys';
import type {
  CancelOrdTokenListingsConfig,
  PurchaseOrdTokenListingConfig,
  CreateOrdTokenListingsConfig,
  TokenUtxo,
  NewTokenListing,
  Utxo,
} from 'js-1sat-ord';
import type { Buffer } from 'buffer';

type ErrorWithMessage = {
    toString(): string;
};

type WalletPaymentModule = typeof import('@/app/lib/wallet-payment');

// Mirror the lightweight fee constants locally so the provider
// doesn't need to import the heavy wallet module on startup.
const P2PKH_INPUT_SIZE = 36 + 1 + (1 + 73 + 1 + 33) + 4;
const FEE_FACTOR = 0.5;
const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'bitcoin';

let walletPaymentPromise: Promise<WalletPaymentModule> | null = null;
const loadWalletPayment = () => {
  if (!walletPaymentPromise) {
    walletPaymentPromise = import('@/app/lib/wallet-payment');
  }
  return walletPaymentPromise;
};

// --- Lazy-load heavy crypto/ord modules to reduce initial JS ---
let ordModulePromise: Promise<typeof import('js-1sat-ord')> | null = null;
const loadOrdModule = () => {
  if (!ordModulePromise) {
    ordModulePromise = import('js-1sat-ord');
  }
  return ordModulePromise;
};

let scryptModulePromise: Promise<typeof import('scrypt-ts')> | null = null;
const loadScryptModule = () => {
  if (!scryptModulePromise) {
    scryptModulePromise = import('scrypt-ts');
  }
  return scryptModulePromise;
};

let bip38ModulePromise: Promise<typeof import('@asoltys/bip38')> | null = null;
const loadBip38Module = () => {
  if (!bip38ModulePromise) {
    bip38ModulePromise = import('@asoltys/bip38');
  }
  return bip38ModulePromise;
};

let wifModulePromise: Promise<typeof import('wif')> | null = null;
const loadWifModule = () => {
  if (!wifModulePromise) {
    wifModulePromise = import('wif');
  }
  return wifModulePromise;
};

let bsvSdkPromise: Promise<typeof import('@bsv/sdk')> | null = null;
const loadBsvSdk = () => {
  if (!bsvSdkPromise) {
    bsvSdkPromise = import('@bsv/sdk');
  }
  return bsvSdkPromise;
};

let bufferPromise: Promise<typeof import('buffer')> | null = null;
const loadBufferModule = () => {
  if (!bufferPromise) {
    bufferPromise = import('buffer');
  }
  return bufferPromise;
};

// BIP38 helpers for encrypting/decrypting WIF
const DEFAULT_SCRYPT_PARAMS = { N: 16384, r: 8, p: 8, asyncTickInterval: 25 } as const;
const encryptWif = async (wifStr: string, passphrase: string): Promise<string> => {
  const [wif, bip38] = await Promise.all([loadWifModule(), loadBip38Module()]);
  const { privateKey, compressed } = wif.decode(wifStr);
  return (bip38 as any).encrypt(privateKey, compressed, passphrase, undefined, DEFAULT_SCRYPT_PARAMS);
};

const decryptToWif = async (
  encrypted: string,
  passphrase: string,
  onProgress?: (percent: number) => void
): Promise<string> => {
  // Use bip38 progress callback to log percent updates
  const bip38 = await loadBip38Module();
  const { PrivateKey } = await loadBsvSdk();
  const result: any = (bip38 as any).decrypt(encrypted, passphrase, (status: any) => {
    if (typeof status?.percent === 'number') {
      onProgress?.(status.percent);
    }
  }, DEFAULT_SCRYPT_PARAMS);

  let privateKeyBytes: Uint8Array | Buffer;
  let isCompressed = true;
  if (result && typeof result === 'object' && 'privateKey' in result) {
    privateKeyBytes = (result as any).privateKey as Uint8Array | Buffer;
    isCompressed = !!(result as any).compressed;
  } else {
    // Some implementations return the raw private key Buffer directly
    privateKeyBytes = result as Buffer;
  }
  if (!privateKeyBytes) {
    throw new Error('Failed to decrypt BIP38 key');
  }

  // Use @bsv/sdk to construct a PrivateKey and output WIF (compressed by default)
  const pk = new PrivateKey(Array.from(privateKeyBytes));
  return pk.toWif();
};

// Async version using @asoltys/bip38 to free the event loop and allow progress UI updates
const decryptToWifAsync = async (
  encrypted: string,
  passphrase: string,
  onProgress?: (percent: number) => void
): Promise<string> => {
  const bip38 = await loadBip38Module();
  const { PrivateKey } = await loadBsvSdk();
  const result: any = await (bip38 as any).decryptAsync(
    encrypted,
    passphrase,
    (pct: number) => {
      if (typeof pct === 'number') {
        // Some libs emit 0..1, others 0..100. Normalize to 0..100.
        const normalized = pct <= 1 ? pct * 100 : pct;
        const clamped = Math.max(0, Math.min(100, normalized));
        const whole = Math.floor(clamped);
        onProgress?.(whole);
      }
    },
    { ...DEFAULT_SCRYPT_PARAMS, asyncTickInterval: 25 }
  );

  let privateKeyBytes: Uint8Array | Buffer;
  if (result && typeof result === 'object' && 'privateKey' in result) {
    privateKeyBytes = (result as any).privateKey as Uint8Array | Buffer;
  } else {
    privateKeyBytes = result as Buffer;
  }
  if (!privateKeyBytes) {
    throw new Error('Failed to decrypt BIP38 key');
  }
  const pk = new PrivateKey(Array.from(privateKeyBytes as Uint8Array));
  return pk.toWif();
};

// Type for restored wallet addresses
export type RestoredWalletInfo = {
    ownerAddress: string;
    paymentAddress: string;
    ownerKey?: string; // Optional, depending if needed outside
    paymentKey?: string; // Optional
};


interface WalletState {
  isWalletInitialized: boolean;
  walletAddress: string; // Current locally active wallet payment address
  ownerAddress: string;  // Current locally active wallet owner address
  profileOwnerAddress: string | null; // Owner address stored in user profile
  profilePaymentAddress: string | null; // Payment address stored in user profile
  profileOwnerKeyBip38?: string | null; // Encrypted owner key
  profilePaymentKeyBip38?: string | null; // Encrypted payment key
  profileUsername: string | null; // Username from profile
  profileAvatarUrl: string | null; // Avatar URL from profile
  walletBalance: number;
  confirmedBalance: number; // NEW: Confirmed balance
  unconfirmedBalance: number; // NEW: Unconfirmed balance (will be 0 due to API issues)
  unconfirmedTxs: Array<{txid: string; value: number}>; // NEW: Array of unconfirmed transactions
  bsvPrice: number;
  isPasskeySupported: boolean;
  isWalletReady: boolean; // NEW: Computed property for wallet readiness
  isLoading: boolean;
  isFetchingBalance: boolean;
  isSending: boolean;
  isCreating: boolean;
  isUnlocking: boolean;
  isFetchingProfile: boolean; // Loading state for fetching profile addresses
  isUpdatingProfile: boolean; // Loading state for updating profile addresses
  isCreatingListing: boolean; // Loading state for creating listings
  activeCredentialId: string | null; // Track the ID of the currently unlocked/created passkey
}

// Define the Utxo type expected by js-1sat-ord if not already accessible
// This should match the Utxo type from 'js-1sat-ord'
interface AdaptedUtxo {
  txid: string;
  vout: number;
  satoshis: number;
  script: string; // Script hex
}

interface WalletActions {
  logout: () => void;
  fetchBalance: () => Promise<void>;
  fetchDetailedBalance: () => Promise<void>; // NEW: Fetch confirmed and unconfirmed balance
  createWallet: (name: string) => Promise<{ success: boolean; restoredInfo?: RestoredWalletInfo }>;
  sendTransaction: (amount: number, address: string) => Promise<string | null>;
  prepareMintFundingOutputs: (
    outputSatoshis: number,
    count: number
  ) => Promise<string | null>;
  backupWallet: (filename: string) => void;
  copyToClipboard: (text: string) => Promise<void>;
  calculateUSDValue: (sats: number) => string;
  fetchProfileAddresses: () => Promise<void>; // Function to explicitly fetch profile addresses
  unlinkProfileWallet: () => Promise<boolean>; // New action to unlink wallet from profile
  signAndFundTx: (rawtx: string) => Promise<string>; // New action for funding/signing
  getUtxosForOrdinalCreation: (estimatedAmountInSats: number) => Promise<AdaptedUtxo[]>; // New action
  saveEncryptedKeys: (
    password: string,
    ownerWif: string,
    payWif: string,
    ownerAddr: string,
    payAddr: string
  ) => Promise<boolean>; // Save BIP38-encrypted keys to profile
  unlockWithPassword: (password: string, onProgress?: (percent: number) => void) => Promise<{ success: boolean; restoredInfo?: RestoredWalletInfo }>; // Decrypt from profile and restore
  createTokenListing: (
    tokenUtxos: Array<{ txid: string; vout: number; amt: string; script: string }>,
    pricePerToken: number,
    tokensToList: number,
    tokenId: string,
    decimals?: number
  ) => Promise<{ success: boolean; txid?: string }>; // Create BSV21 token listing
  purchaseTokenListing: (
    listing: { txid: string; vout: number; amt: string; script: string; price: string; payout: string },
    tokenId: string
  ) => Promise<{ success: boolean; txid?: string }>; // Purchase BSV21 token listing
  cancelTokenListing: (
    listing: { txid: string; vout: number; script: string; amt: string },
    tokenId: string
  ) => Promise<{ success: boolean; txid?: string }>; // Cancel BSV21 token listing
  isPurchasingToken: boolean; // Loading state for token purchase
  isCancellingTokenListing: boolean; // Loading state for token listing cancellation
}

interface WalletContextProps extends WalletState, WalletActions {}

const WalletContext = createContext<WalletContextProps | undefined>(undefined);

interface WalletProviderProps {
  children: ReactNode;
}

export const WalletProvider: React.FC<WalletProviderProps> = ({ children }) => {
  // Local Wallet State
  const [isWalletInitialized, setIsWalletInitialized] = useState(false);
  const [walletAddress, setWalletAddress] = useState('');
  const [ownerAddress, setOwnerAddress] = useState('');
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [confirmedBalance, setConfirmedBalance] = useState<number>(0);
  const [unconfirmedBalance, setUnconfirmedBalance] = useState<number>(0);
  const [unconfirmedTxs, setUnconfirmedTxs] = useState<Array<{txid: string; value: number}>>([]);

  // Profile Wallet State
  const [profileOwnerAddress, setProfileOwnerAddress] = useState<string | null>(null);
  const [profilePaymentAddress, setProfilePaymentAddress] = useState<string | null>(null);
  const [profileOwnerKeyBip38, setProfileOwnerKeyBip38] = useState<string | null>(null);
  const [profilePaymentKeyBip38, setProfilePaymentKeyBip38] = useState<string | null>(null);
  const [profileUsername, setProfileUsername] = useState<string | null>(null);
  const [profileAvatarUrl, setProfileAvatarUrl] = useState<string | null>(null);

  // General State
  const { bsvPrice } = useBSVPrice();
  const [isPasskeySupported, setIsPasskeySupported] = useState(false);

  // Loading States
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingBalance, setIsFetchingBalance] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);
  const [isFetchingProfile, setIsFetchingProfile] = useState(false);
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);
  const [isCreatingListing, setIsCreatingListing] = useState(false);
  const [isPurchasingToken, setIsPurchasingToken] = useState(false);
  const [isCancellingTokenListing, setIsCancellingTokenListing] = useState(false);

  const [activeCredentialId, setActiveCredentialId] = useState<string | null>(null); // Add state for active credential ID
  const [profileFetchAttempted, setProfileFetchAttempted] = useState(false); // Track initial profile fetch

  const { user: authUser, isLoading: isAuthLoading } = useAuth();
  const { toast } = useToast();

  // Combine loading states for the general `isLoading` flag
  useEffect(() => {
    setIsLoading(
        isFetchingBalance ||
        isSending ||
        isCreating ||
        isUnlocking ||
        isFetchingProfile || // Include profile loading states
        isUpdatingProfile ||
        isCreatingListing
    );
  }, [
    isFetchingBalance,
    isSending,
    isCreating,
    isUnlocking,
    isFetchingProfile,
    isUpdatingProfile,
    isCreatingListing,
  ]);

  useEffect(() => {
    setIsWalletInitialized(false);
    setWalletAddress('');
    setOwnerAddress('');

    const passkeySupport = isPasskeyAvailable();
    setIsPasskeySupported(passkeySupport);
  }, []);

  const fetchBalance = useCallback(async () => {
    // Use internal state `walletAddress` instead of localStorage directly
    if (!isWalletInitialized || !walletAddress) {
      console.log('Skipping balance fetch: Wallet not initialized or address missing.');
      return;
    }
    console.log('Fetching balance for address:', walletAddress);
    setIsFetchingBalance(true);
    try {
      const { getWalletBalance } = await loadWalletPayment();
      const balanceInSatoshis = await getWalletBalance(walletAddress);
      setWalletBalance(balanceInSatoshis);
      console.log('Balance updated:', balanceInSatoshis);
    } catch (error) {
      console.error('Error fetching balance:', error);
      toast({
        variant: 'destructive',
        description: 'Error fetching balance',
        duration: 1500,
      });
      setWalletBalance(0); // Reset balance on error
    } finally {
      setIsFetchingBalance(false);
    }
  }, [isWalletInitialized, walletAddress, toast]);

  // --- New Function: Fetch detailed balance (confirmed and unconfirmed) ---
  const fetchDetailedBalance = useCallback(async () => {
    if (!isWalletInitialized || !walletAddress) {
      console.log('Skipping detailed balance fetch: Wallet not initialized or address missing.');
      return;
    }
    console.log('Fetching detailed balance for address:', walletAddress);
    setIsFetchingBalance(true);
    try {
      // Fetch confirmed and unconfirmed UTXOs in parallel using WhatsOnChain endpoints
      const [confirmedResponse, unconfirmedResponse] = await Promise.all([
        fetch(`https://api.whatsonchain.com/v1/bsv/main/address/${walletAddress}/confirmed/unspent`),
        fetch(`https://api.whatsonchain.com/v1/bsv/main/address/${walletAddress}/unconfirmed/unspent`)
      ]);

      // Handle 404 responses gracefully (new addresses with no transactions)
      let confirmedData, unconfirmedData;
      
      if (confirmedResponse.status === 404) {
        // Address has no confirmed UTXOs
        confirmedData = { result: [] };
      } else if (!confirmedResponse.ok) {
        throw new Error(`Failed to fetch confirmed UTXOs (status: ${confirmedResponse.status})`);
      } else {
        confirmedData = await confirmedResponse.json();
      }

      if (unconfirmedResponse.status === 404) {
        // Address has no unconfirmed UTXOs
        unconfirmedData = { result: [] };
      } else if (!unconfirmedResponse.ok) {
        throw new Error(`Failed to fetch unconfirmed UTXOs (status: ${unconfirmedResponse.status})`);
      } else {
        unconfirmedData = await unconfirmedResponse.json();
      }

      if (confirmedData.error && confirmedData.error !== "") {
        throw new Error(`Confirmed UTXOs API error: ${confirmedData.error}`);
      }
      if (unconfirmedData.error && unconfirmedData.error !== "") {
        throw new Error(`Unconfirmed UTXOs API error: ${unconfirmedData.error}`);
      }

      // Calculate confirmed balance (excluding UTXOs spent in mempool)
      const confirmedUtxos = confirmedData.result || [];
      const availableConfirmedUtxos = confirmedUtxos.filter((utxo: any) => !utxo.isSpentInMempoolTx);
      const confirmedSats = availableConfirmedUtxos.reduce((sum: number, utxo: any) => sum + (utxo.value || 0), 0);

      // Process unconfirmed UTXOs - don't sum values (they're 0), just collect transaction info
      const unconfirmedUtxos = unconfirmedData.result || [];
      const unconfirmedTxList = unconfirmedUtxos.map((utxo: any) => ({
        txid: utxo.tx_hash || utxo.txid,
        value: utxo.value || 0
      }));

      // For total balance, only use confirmed balance since unconfirmed values are unreliable
      const totalBalance = confirmedSats;

      // Update all balance states
      setWalletBalance(totalBalance);
      setConfirmedBalance(confirmedSats);
      setUnconfirmedBalance(0); // Set to 0 since values are unreliable
      setUnconfirmedTxs(unconfirmedTxList);

      console.log('Detailed balance updated using WhatsOnChain APIs:', {
        total: totalBalance,
        confirmed: confirmedSats,
        unconfirmed: 0,
        confirmedUtxoCount: availableConfirmedUtxos.length,
        unconfirmedTxCount: unconfirmedTxList.length,
        unconfirmedTxs: unconfirmedTxList
      });

    } catch (error) {
      console.error('Error fetching detailed balance:', error);
      toast({
        variant: 'destructive',
        description: 'Error fetching balance details',
        duration: 1500,
      });
      // Reset balances on error
      setWalletBalance(0);
      setConfirmedBalance(0);
      setUnconfirmedBalance(0);
      setUnconfirmedTxs([]);
    } finally {
      setIsFetchingBalance(false);
    }
  }, [isWalletInitialized, walletAddress, toast]);

  // --- Effect to fetch detailed balance when local wallet initializes ---
  useEffect(() => {
      if (isWalletInitialized && walletAddress) {
          console.log('useWallet Effect: Local wallet initialized, fetching detailed balance...');
          fetchDetailedBalance();
      }
      // We don't fetch if isWalletInitialized becomes false (e.g., on unlink/logout)
  }, [isWalletInitialized, walletAddress, fetchDetailedBalance]);


  // --- New Function: Fetch profile addresses ---
  const fetchProfileAddresses = useCallback(async () => {
    console.log('Fetching profile addresses...');
    setIsFetchingProfile(true);
    setProfileOwnerAddress(null); // Reset before fetching
    setProfilePaymentAddress(null);
    setProfileUsername(null);
    setProfileAvatarUrl(null);
    try {
      const response = await fetch('/api/profiles/me'); // Use the GET endpoint
      if (!response.ok) {
          if (response.status === 401) {
              console.warn('Not authorized to fetch profile addresses (likely not logged in yet).');
              // Don't show error toast here, might be expected during login flow
              return; // Exit silently
          }
          const errorData = await response.json().catch(() => ({})); // Try to parse error
          throw new Error(errorData.error || `Failed to fetch profile: ${response.statusText}`);
      }
      const data = await response.json();
      console.log('Profile data fetched:', data);
      setProfileOwnerAddress(data.owner_address || null);
      setProfilePaymentAddress(data.payment_address || null);
      setProfileOwnerKeyBip38(data.owner_key_bip38 || null);
      setProfilePaymentKeyBip38(data.payment_key_bip38 || null);
      setProfileUsername(data.username || null);
      setProfileAvatarUrl(data.avatar_url || null);
    } catch (error) {
      console.error('Error fetching profile addresses:', error);
      toast({
        variant: 'destructive',
        description: `Could not load profile data: ${(error as Error).message}`,
        duration: 2000,
      });
      // Keep addresses as null on error
    } finally {
      setIsFetchingProfile(false);
    }
  }, [toast]);

  // Save encrypted keys to profile
  const saveEncryptedKeys = useCallback(async (
      password: string,
      ownerWif: string,
      payWif: string,
      ownerAddr: string,
      payAddr: string
    ): Promise<boolean> => {
      try {
          if (!ownerWif || !payWif || !ownerAddr || !payAddr) {
              toast({ variant: 'destructive', description: 'Keys or addresses missing for encryption', duration: 1500 });
              return false;
          }
          const [encOwner, encPay] = await Promise.all([
            encryptWif(ownerWif, password),
            encryptWif(payWif, password),
          ]);

          const response = await fetch('/api/profiles/me', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  owner_address: ownerAddr,
                  payment_address: payAddr,
                  passkey_credential_id: activeCredentialId ?? null,
                  owner_key_bip38: encOwner,
                  payment_key_bip38: encPay,
              }),
          });
          if (!response.ok) {
              const err = await response.json().catch(() => ({}));
              throw new Error(err.error || 'Failed to save encrypted keys');
          }
          const data = await response.json();
          setProfileOwnerKeyBip38(data.profile?.owner_key_bip38 ?? encOwner);
          setProfilePaymentKeyBip38(data.profile?.payment_key_bip38 ?? encPay);
          setProfileOwnerAddress(data.profile?.owner_address ?? ownerAddr);
          setProfilePaymentAddress(data.profile?.payment_address ?? payAddr);
          toast({ description: 'Encrypted keys saved', duration: 1500 });
          return true;
      } catch (e) {
          console.error('saveEncryptedKeys error:', e);
          toast({ variant: 'destructive', description: (e as Error).message, duration: 2000 });
          return false;
      }
  }, [ownerAddress, walletAddress, activeCredentialId, toast]);

  // Unlock by decrypting from profile with password
  const unlockWithPassword = useCallback(async (password: string, onProgress?: (percent: number) => void): Promise<{ success: boolean; restoredInfo?: RestoredWalletInfo }> => {
      try {
          const r = await fetch('/api/profiles/me');
          if (!r.ok) throw new Error('Failed to load profile');
          const p = await r.json();
          if (!p.owner_key_bip38 || !p.payment_key_bip38) throw new Error('No encrypted keys in profile');
          // Measure total decrypt time for both keys
          const decryptStart = (typeof performance !== 'undefined' ? performance.now() : Date.now());
          // Decrypt without surfacing per-key progress to UI; logs still appear from decryptToWifAsync
          const ownerWif = await decryptToWifAsync(p.owner_key_bip38, password);
          const payWif = await decryptToWifAsync(p.payment_key_bip38, password);
          const decryptEnd = (typeof performance !== 'undefined' ? performance.now() : Date.now());
          const elapsedSeconds = (decryptEnd - decryptStart) / 1000;
          console.log(`BIP38 decrypt total time (both keys): ${elapsedSeconds.toFixed(2)}s`);
          const restoredInfo = await restoreWalletState(ownerWif, payWif);
          if (!restoredInfo) throw new Error('Failed to set decrypted keys locally');
          await fetchDetailedBalance();
          return { success: true, restoredInfo };
      } catch (e) {
          console.error('unlockWithPassword error:', e);
          const message = e instanceof Error ? e.message : String(e);
          toast({ title: 'Unlock failed', variant: 'destructive', description: message, duration: 3000 });
          return { success: false };
      }
  }, []);

  // --- New Action: Unlink wallet from profile --- 
  const unlinkProfileWallet = useCallback(async (): Promise<boolean> => {
      console.log('Unlinking wallet from profile via API...');
      setIsUpdatingProfile(true); // Reuse updating state
      try {
          const response = await fetch('/api/profiles/me', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                  owner_address: null,
                  payment_address: null,
                  passkey_credential_id: null,
              }),
          });

          if (!response.ok) {
              const errorData = await response.json().catch(() => ({}));
              throw new Error(errorData.error || `Failed to unlink profile: ${response.statusText}`);
          }

          // Update local state to reflect unlinking
          setProfileOwnerAddress(null);
          setProfilePaymentAddress(null);

          // Also clear the locally active wallet state
          console.log(' -> Clearing locally active wallet state after unlinking.');
          setIsWalletInitialized(false);
          setWalletAddress('');
          setOwnerAddress('');
          setWalletBalance(0); // Reset balance too
          setActiveCredentialId(null); // Clear active ID
          // Note: We don't clear localStorage here, matching the temporary disabled state

          // toast({
          //     description: "Wallet unlinked from profile.",
          //     duration: 2000,
          // });
          return true;

      } catch (error) {
          console.error('Error unlinking profile wallet:', error);
          toast({
              variant: "destructive",
              title: "Unlink Failed",
              description: `Could not unlink wallet: ${(error as Error).message}`,
              duration: 2000,
          });
          return false;
      } finally {
          setIsUpdatingProfile(false);
      }
  }, [toast]);

  // --- Modified: restoreWalletState - Reads from sessionStorage after restoreWallet ---
  const restoreWalletState = useCallback(
    async (ordPk: string, payPk: string): Promise<RestoredWalletInfo | null> => {
      try {
          const { restoreWallet } = await loadWalletPayment();
          restoreWallet(ordPk, payPk);

          // Read the values back from sessionStorage
          const restoredPaymentAddress = sessionStorage.getItem('walletAddress');
          const restoredOwnerAddress = sessionStorage.getItem('ownerAddress');

          if (restoredPaymentAddress && restoredOwnerAddress) {
              console.log('Wallet state restored locally via restoreWalletState. Payment Address:', restoredPaymentAddress, 'Owner Address:', restoredOwnerAddress);

              // Keys are already written by restoreWallet to sessionStorage

              // Update React state using the values read from localStorage
              setWalletAddress(restoredPaymentAddress);
              setOwnerAddress(restoredOwnerAddress);
              setIsWalletInitialized(true); // Set initialized *after* setting addresses
              setWalletBalance(0); // Reset balance, fetch triggered by useEffect
              setActiveCredentialId(null); // Clear active ID as well on restore

              // --- REMOVED Profile Address Clearing ---
              // setProfileOwnerAddress(null);
              // setProfilePaymentAddress(null);
              // setProfilePasskeyId(null);

              // Return minimal necessary info (addresses)
              return {
                  ownerAddress: restoredOwnerAddress,
                  paymentAddress: restoredPaymentAddress,
              };
          } else {
              // Handle case where localStorage wasn't updated as expected
              throw new Error("Necessary address data not found in localStorage after restoreWallet call.");
          }
      } catch (error) {
          console.error("Failed to restore wallet state:", error);
          // Clear React state on error
          setIsWalletInitialized(false);
          setWalletAddress('');
          setOwnerAddress('');
          setWalletBalance(0);
          setActiveCredentialId(null);
          // Also clear profile? Maybe not here, only on explicit logout/unlink
          // setProfileOwnerAddress(null);
          // setProfilePaymentAddress(null);
          // setProfilePasskeyId(null);
          toast({ variant: 'destructive', description: `Failed to restore wallet state: ${(error as Error).message}`, duration: 2000 });
          return null; // Indicate failure
      }
    },
    [toast] // Dependencies
  );


  // --- Modified: createWallet - Uses updated restoreWalletState ---
  const createWallet = useCallback(
    async (name: string): Promise<{ success: boolean; restoredInfo?: RestoredWalletInfo }> => {
      if (!name.trim()) {
        toast({ variant: 'destructive', description: 'Please enter a wallet name', duration: 1500 });
        return { success: false };
      }

      console.log(`Creating wallet "${name}"...`);
      setIsCreating(true);
      try {
        const { newPK } = await loadWalletPayment();
        const paymentPk = newPK();
        const ownerPK = newPK();

        if (!paymentPk || !ownerPK) {
          throw new Error('Failed to generate new private keys.');
        }

        // Restore wallet state locally FIRST
        const restoredInfo = await restoreWalletState(ownerPK, paymentPk);
        if (!restoredInfo) {
            throw new Error("Failed to set new wallet keys locally."); // restoreWalletState handles toast
        }

        setActiveCredentialId(null);

        toast({ description: 'New wallet created. Please backup now.', duration: 2000 });
        // Return success and the restored addresses
        return { success: true, restoredInfo };
      } catch (error) {
        console.error('Error creating wallet:', error);
        // Avoid double-toasting if restoreWalletState failed
        if (!((error as Error)?.message === "Failed to set new wallet keys locally.")) {
            toast({
                variant: 'destructive',
                description: `Failed to create wallet: ${(error as ErrorWithMessage).toString()}`,
                duration: 2000,
            });
        }
        return { success: false };
      } finally {
        setIsCreating(false);
      }
    },
    [restoreWalletState, toast]
  );

  const sendTransaction = useCallback(
    async (amount: number, address: string): Promise<string | null> => {
      if (!isWalletInitialized) {
        toast({ variant: 'destructive', description: 'Wallet not initialized', duration: 1000 });
        return null;
      }
      if (!address || !amount || amount <= 0) {
        toast({ variant: 'destructive', description: 'Invalid address or amount', duration: 1000 });
        return null;
      }
      console.log(`Sending ${amount} sats to ${address}`);
      setIsSending(true);
      try {
        const { sendBSV } = await loadWalletPayment();
        const txid = await sendBSV(amount, address, walletAddress);
        if (txid) {
          await fetchDetailedBalance(); // Update balance after successful send
          toast({ description: `Transaction sent: ${txid.substring(0, 8)}...`, duration: 2000 });
          return txid;
        } else {
          // sendBSV should have toasted the error based on its implementation
          return null;
        }
      } catch (error) {
        console.error('Send error in context:', error);
        toast({
          variant: 'destructive',
          description: `Failed to send transaction: ${(error as ErrorWithMessage).toString()}`,
          duration: 1500,
        });
        return null;
      } finally {
        setIsSending(false);
      }
    },
    [isWalletInitialized, fetchDetailedBalance, toast, walletAddress] // Added walletAddress dependency
  );

  const prepareMintFundingOutputs = useCallback(
    async (outputSatoshis: number, count: number): Promise<string | null> => {
      if (!isWalletInitialized) {
        toast({ variant: 'destructive', description: 'Wallet not initialized', duration: 1000 });
        return null;
      }
      if (!walletAddress) {
        toast({ variant: 'destructive', description: 'Payment address unavailable', duration: 1000 });
        return null;
      }
      if (!Number.isInteger(outputSatoshis) || outputSatoshis <= 0) {
        toast({ variant: 'destructive', description: 'Invalid mint funding size', duration: 1000 });
        return null;
      }
      if (!Number.isInteger(count) || count < 1) {
        toast({ variant: 'destructive', description: 'Choose at least one mint UTXO', duration: 1000 });
        return null;
      }

      console.log('Preparing mint funding outputs', { outputSatoshis, count, walletAddress });
      setIsSending(true);
      try {
        const { splitForMintFunding } = await loadWalletPayment();
        const txid = await splitForMintFunding(walletAddress, outputSatoshis, count);
        if (txid) {
          await fetchDetailedBalance();
          toast({
            description: `Created ${count} LLM funding UTXO${count === 1 ? '' : 's'}: ${txid.substring(0, 8)}...`,
            duration: 2500,
          });
          return txid;
        }
        return null;
      } catch (error) {
        console.error('Prepare LLM funding error:', error);
        toast({
          variant: 'destructive',
          description: `Failed to prepare LLM UTXOs: ${(error as ErrorWithMessage).toString()}`,
          duration: 2500,
        });
        return null;
      } finally {
        setIsSending(false);
      }
    },
    [isWalletInitialized, fetchDetailedBalance, toast, walletAddress]
  );

  const backupWallet = useCallback((filename: string) => {
    if (!filename.trim()) {
      toast({ variant: 'destructive', description: 'Please enter a filename', duration: 1500 });
      return;
    }

    // Only allow downloading encrypted keys that are stored on the profile (database)
    if (!profileOwnerKeyBip38 || !profilePaymentKeyBip38) {
      toast({
        variant: 'destructive',
        title: 'Encrypted keys not found',
        description: 'Create or save your encrypted keys to your profile before backing up.',
        duration: 2000,
      });
      return;
    }

    const backupOwnerAddress = profileOwnerAddress || ownerAddress || null;
    const backupPaymentAddress = profilePaymentAddress || walletAddress || null;

    const payload = {
      owner_address: backupOwnerAddress,
      payment_address: backupPaymentAddress,
      owner_key_bip38: profileOwnerKeyBip38,
      payment_key_bip38: profilePaymentKeyBip38,
      metadata: {
        format: `${APP_NAME}-bip38-backup`,
        version: 2,
        created_at: new Date().toISOString(),
      },
    };

    const dataStr = JSON.stringify(payload, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    const finalFilename = filename.toLowerCase().endsWith('.json') ? filename : `${filename}.json`;

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', finalFilename);
    linkElement.click();

    toast({ description: 'Encrypted key backup downloaded', duration: 1500 });
  }, [
    ownerAddress,
    profileOwnerAddress,
    profileOwnerKeyBip38,
    profilePaymentAddress,
    profilePaymentKeyBip38,
    toast,
    walletAddress,
  ]);

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ description: "Address copied to clipboard", duration: 1500 });
    } catch (err) {
      console.error('Failed to copy:', err);
      toast({ variant: "destructive", description: "Failed to copy address", duration: 1500 });
    }
  }, [toast]);

  const calculateUSDValue = useCallback((sats: number): string => {
      const satoshis = Number(sats);
      if (isNaN(satoshis) || bsvPrice <= 0) {
          return '0.0000';
      }
      const bsv = satoshis / 100000000;
      const usd = bsv * bsvPrice;
      if (isNaN(usd)) {
          return '0.0000';
      }
      return usd.toLocaleString('en-US', {
          minimumFractionDigits: 4,
          maximumFractionDigits: 4
      });
  }, [bsvPrice]);


  const logout = useCallback(() => {
    setIsWalletInitialized(false);
    setWalletAddress('');
    setOwnerAddress('');
    setWalletBalance(0);
    setProfileOwnerAddress(null); // Clear profile addresses on logout
    setProfilePaymentAddress(null);
    setActiveCredentialId(null);
    setProfileFetchAttempted(false); // Reset fetch attempt flag on logout

    window.dispatchEvent(new Event('walletDisconnected'));
  }, [toast]);

  // --- Track user ID to detect user changes ---
  const [previousUserId, setPreviousUserId] = useState<string | null>(null);
  
  // --- Effect to Reset State When User Changes ---
  useEffect(() => {
    const currentUserId = authUser?.id || null;
    
    // If user changed (logged out, logged in as different user, or new signup)
    if (previousUserId !== null && previousUserId !== currentUserId) {
      console.log('WalletProvider: User changed from', previousUserId, 'to', currentUserId, '- resetting all state');
      
      // Clear sessionStorage wallet data
      sessionStorage.removeItem('walletAddress');
      sessionStorage.removeItem('ownerAddress');
      sessionStorage.removeItem('walletKey');
      sessionStorage.removeItem('ownerKey');
      
      // Reset wallet state
      setIsWalletInitialized(false);
      setWalletAddress('');
      setOwnerAddress('');
      setWalletBalance(0);
      setConfirmedBalance(0);
      setUnconfirmedBalance(0);
      setUnconfirmedTxs([]);
      setActiveCredentialId(null);
      
      // Reset profile state
      setProfileOwnerAddress(null);
      setProfilePaymentAddress(null);
      setProfileOwnerKeyBip38(null);
      setProfilePaymentKeyBip38(null);
      setProfileUsername(null);
      setProfileAvatarUrl(null);
      
      // Reset profile fetch flag so it will fetch again for new user
      setProfileFetchAttempted(false);
    }
    
    // Update the tracked user ID
    setPreviousUserId(currentUserId);
  }, [authUser?.id, previousUserId]);

  // --- Effect to Fetch Profile on Auth Change ---
  useEffect(() => {
    // Fetch profile ONLY when:
    // 1. Auth state is finalized (not loading) and we have a user
    // 2. We haven't already attempted to fetch the profile in this session
    // 3. We aren't already in the middle of fetching it
    if (authUser && !isAuthLoading && !profileFetchAttempted && !isFetchingProfile) {
      console.log('WalletProvider: Auth user detected AND profile fetch not attempted, triggering...');
      setProfileFetchAttempted(true); // Mark that we are attempting the fetch
      fetchProfileAddresses();
    }
    // Dependencies focus on auth state and fetching status
  }, [authUser, isAuthLoading, isFetchingProfile, profileFetchAttempted, fetchProfileAddresses]);

  // --- Effect for Automatic Wallet Restoration on Refresh ---
  useEffect(() => {
    console.log('Auto-restore Check: Running effect...');
    // Conditions to attempt auto-restore:
    // 1. Auth is loaded and user is logged in
    // 2. Profile fetch is complete
    // 3. Wallet is NOT already initialized in this session
    if (!isAuthLoading && authUser && !isFetchingProfile && !isWalletInitialized) {
      console.log('Auto-restore Check: Conditions met. Profile addresses:', profileOwnerAddress, profilePaymentAddress);

      // Check if profile has linked addresses
      if (profileOwnerAddress && profilePaymentAddress) {
        console.log('Auto-restore Check: Profile has linked addresses.');
        // Read addresses and keys from sessionStorage
        const lsOwnerAddress = sessionStorage.getItem('ownerAddress');
        const lsPaymentAddress = sessionStorage.getItem('walletAddress');
        const lsOwnerKey = sessionStorage.getItem('ownerKey');
        const lsPaymentKey = sessionStorage.getItem('walletKey');

        console.log('Auto-restore Check: localStorage values:', { lsOwnerAddress, lsPaymentAddress, lsOwnerKey: !!lsOwnerKey, lsPaymentKey: !!lsPaymentKey });

        // VERIFY: Check if localStorage addresses match profile addresses
        if (
          lsOwnerAddress === profileOwnerAddress &&
          lsPaymentAddress === profilePaymentAddress
        ) {
          console.log('Auto-restore Check: localStorage addresses MATCH profile addresses.');
          // VERIFY: Check if keys also exist in localStorage
          if (lsOwnerKey && lsPaymentKey) {
            console.log('Auto-restore Check: Keys found in sessionStorage. Attempting restore...');
            // Restore wallet state using the keys
            void restoreWalletState(lsOwnerKey, lsPaymentKey);
            // Note: restoreWalletState sets isWalletInitialized to true
          } else {
            console.warn('Auto-restore Check: Address match, but keys missing from sessionStorage. Cannot restore.');
          }
        } else {
          console.warn('Auto-restore Check: localStorage addresses DO NOT match profile addresses. Not restoring.');
          // Ensure wallet is marked as uninitialized if mismatch found
           if(isWalletInitialized) { // Double check just in case state changes during effect
               setIsWalletInitialized(false);
               setWalletAddress('');
               setOwnerAddress('');
               setWalletBalance(0);
               setActiveCredentialId(null); // Ensure active ID is cleared
           }
        }
      } else {
         console.log('Auto-restore Check: Profile has no linked addresses. Skipping restore.');
         // Ensure wallet is marked as uninitialized if profile has no addresses
         if(isWalletInitialized) { // Double check just in case
             setIsWalletInitialized(false);
             setWalletAddress('');
             setOwnerAddress('');
             setWalletBalance(0);
             setActiveCredentialId(null);
         }
      }
    } else {
       console.log('Auto-restore Check: Conditions not met or wallet already initialized.', { isAuthLoading, hasAuthUser: !!authUser, isFetchingProfile, isWalletInitialized });
    }
  }, [
    isAuthLoading,
    authUser,
    isFetchingProfile,
    profileOwnerAddress,
    profilePaymentAddress,
    isWalletInitialized, // Re-run if wallet becomes uninitialized
    restoreWalletState, // Include restoreWalletState as it's called inside
    // Include setters used in the "ensure uninitialized" blocks
    setIsWalletInitialized,
    setWalletAddress,
    setOwnerAddress,
    setWalletBalance,
    setActiveCredentialId 
  ]);

  // --- New Function: Sign and Fund Transaction --- 
  const signAndFundTx = useCallback(async (rawtx: string): Promise<string> => {
      console.log("signAndFundTx: Received rawtx:", rawtx);
      if (!isWalletInitialized || !walletAddress) {
          toast({ variant: 'destructive', description: 'Wallet not initialized or address missing.', duration: 2000 });
          throw new Error('Wallet not initialized or address missing.');
      }

      const privateKeyWIF = sessionStorage.getItem('walletKey');
      if (!privateKeyWIF) {
          toast({ variant: 'destructive', description: 'Wallet key not found.', duration: 2000 });
          throw new Error('Wallet key not found in session storage.');
      }

      try {
          const [{ bsv }, { fetchPayUtxos }, { Buffer }] = await Promise.all([
            loadScryptModule(),
            loadOrdModule(),
            loadBufferModule(),
          ]);
          const bsvtx = new bsv.Transaction(rawtx);
          const outputSatoshis = bsvtx.outputs.reduce(((t, e) => t + e.satoshis), 0);

          // Estimate fee BEFORE knowing exact UTXOs (assume 1 input for safety)
          // Note: bsv.Transaction automatically adds P2PKH_INPUT_SIZE for fee calc if address passed to .from()?
          // Let's explicitly estimate based on expected input add.
          const initialEstimatedSize = bsvtx.getEstimateSize() + P2PKH_INPUT_SIZE;
          const initialEstimatedFee = Math.ceil(initialEstimatedSize * FEE_FACTOR) + 1;

          const requiredAmount = outputSatoshis + initialEstimatedFee;
          console.log(`signAndFundTx: Required amount (incl. estimated fee): ${requiredAmount}`);

          // Use fetchPayUtxos instead of getPaymentUTXOs
          const allUtxos = await fetchPayUtxos(walletAddress);
          console.log(`signAndFundTx: Found ${allUtxos?.length || 0} total UTXOs.`);
          
          if (!allUtxos || allUtxos.length === 0) { 
              throw new Error('No UTXOs available for funding'); 
          }

          // Select UTXOs manually - sort by value descending and select until we have enough
          const sortedUtxos = allUtxos.sort((a, b) => b.satoshis - a.satoshis);
          const selectedUtxos = [];
          let totalSelected = 0;

          for (const utxo of sortedUtxos) {
              selectedUtxos.push(utxo);
              totalSelected += utxo.satoshis;
              if (totalSelected >= requiredAmount) {
                  break;
              }
          }

          if (totalSelected < requiredAmount) {
              throw new Error(`Insufficient funds. Required: ${requiredAmount} sats, Available: ${totalSelected} sats`);
          }

          console.log(`signAndFundTx: Selected ${selectedUtxos.length} UTXOs with total: ${totalSelected} sats`);

          // Convert js-1sat-ord Utxo format to bsv.Transaction.UnspentOutput format
          const bsvUtxos = selectedUtxos.map(utxo => {
              // Convert script from base64 to hex if it's in base64 format
              let scriptHex = utxo.script;
              if (utxo.script && typeof utxo.script === 'string') {
                  try {
                      // Check if it's base64 by trying to decode it
                      const decoded = Buffer.from(utxo.script, 'base64');
                      // If successful, convert to hex
                      scriptHex = decoded.toString('hex');
                      console.log(`Converted script from base64 to hex: ${utxo.script} -> ${scriptHex}`);
                  } catch (e) {
                      // If it fails, assume it's already hex or another format
                      console.log(`Script appears to already be in hex format: ${utxo.script}`);
                  }
              }
              
              return {
                  txId: utxo.txid,
                  outputIndex: utxo.vout,
                  satoshis: utxo.satoshis,
                  script: scriptHex
              };
          });

          bsvtx.from(bsvUtxos); // Add inputs

          const inputSatoshis = selectedUtxos.reduce(((t, e) => t + e.satoshis), 0);
          console.log(`signAndFundTx: Input satoshis from selected UTXOs: ${inputSatoshis}`);

          // Recalculate fee based on ACTUAL number of inputs added
          const finalEstimatedSize = bsvtx.getEstimateSize(); // Size with actual inputs/outputs
          const finalFee = Math.ceil(finalEstimatedSize * FEE_FACTOR) + 1; // Use the size calculated by the library
          console.log(`signAndFundTx: Final calculated fee: ${finalFee}`);

          const changeAmount = inputSatoshis - outputSatoshis - finalFee;
          console.log(`signAndFundTx: Change amount: ${changeAmount}`);

          if (changeAmount < 0) {
              console.error("Fee calculation error: Change amount negative", { inputSatoshis, outputSatoshis, finalFee });
              // This shouldn't happen often if we selected enough UTXOs, but could if fee estimate was low
              throw new Error(`Insufficient funds after fee calculation. Required: ${outputSatoshis + finalFee} sats. Input Total: ${inputSatoshis}`);
          }

          if (changeAmount > 0) {
              console.log(`signAndFundTx: Adding change output: ${changeAmount} sats to ${walletAddress}`);
              bsvtx.to(walletAddress, changeAmount);
          }

          const privateKey = bsv.PrivateKey.fromWIF(privateKeyWIF);
          bsvtx.sign(privateKey);
          const signedTxHex = bsvtx.toString();

          console.log('signAndFundTx: Successfully signed and funded TX:', signedTxHex);
          return signedTxHex;

      } catch (error) {
          console.error("Error during signAndFundTx:", error);
          toast({
              variant: "destructive",
              title: "Transaction Error",
              description: `Failed to fund or sign: ${(error as Error).message}`,
              duration: 2000
          });
          throw error; // Re-throw the error to be caught by the caller
      }
  }, [isWalletInitialized, walletAddress, toast]);

  // --- New Function: Get UTXOs for Ordinal Creation ---
  const getUtxosForOrdinalCreation = useCallback(async (estimatedAmountInSats: number): Promise<AdaptedUtxo[]> => {
    if (!isWalletInitialized || !walletAddress) {
      toast({ variant: 'destructive', description: 'Wallet not initialized or address missing.', duration: 2000 });
      throw new Error('Wallet not initialized or address missing.');
    }

    console.log(`getUtxosForOrdinalCreation: Fetching UTXOs for approx ${estimatedAmountInSats} sats for address ${walletAddress}`);

    try {
      const { getPaymentUTXOs } = await loadWalletPayment();
      const paymentUtxos = await getPaymentUTXOs(walletAddress, estimatedAmountInSats);

      if (!paymentUtxos || paymentUtxos.length === 0) {
        throw new Error(`No UTXOs found for the estimated amount of ${estimatedAmountInSats} sats.`);
      }

      console.log(`getUtxosForOrdinalCreation: Received ${paymentUtxos.length} UTXO(s).`);

      const adaptedUtxos: AdaptedUtxo[] = paymentUtxos.map((utxo: any) => {
        const scriptHex = typeof utxo.script === 'string' ? utxo.script : utxo.script?.toHex?.();
        if (!scriptHex && utxo.script) {
          console.warn('UTXO script cannot be converted to hex:', utxo);
          throw new Error(
            `UTXO (txid: ${utxo.txId || utxo.txid}, vout: ${utxo.outputIndex !== undefined ? utxo.outputIndex : utxo.vout}) has an invalid script format.`
          );
        }
        return {
          txid: utxo.txId || utxo.txid, // Adapt to potential naming differences (txId vs txid)
          vout: utxo.outputIndex !== undefined ? utxo.outputIndex : utxo.vout, // outputIndex vs vout
          satoshis: utxo.satoshis,
          script: scriptHex || '', // Provide empty string if script was null/undefined initially
        };
      });

      console.log(`getUtxosForOrdinalCreation: Adapted ${adaptedUtxos.length} UTXO(s) for js-1sat-ord.`);
      return adaptedUtxos;

    } catch (error) {
      console.error("Error in getUtxosForOrdinalCreation:", error);
      toast({
        variant: "destructive",
        title: "UTXO Fetching Error",
        description: `Failed to get UTXOs for ordinal creation: ${(error as Error).message}`,
        duration: 2000
      });
      throw error; // Re-throw the error
    }
  }, [isWalletInitialized, walletAddress, toast]);

  // --- New Function: Create Token Listing (BSV21) ---
  const createTokenListing = useCallback(async (
    tokenUtxos: Array<{ txid: string; vout: number; amt: string; script: string }>,
    pricePerToken: number,
    tokensToList: number,
    tokenId: string,
    decimals: number = 0
  ): Promise<{ success: boolean; txid?: string }> => {
    console.log('=== createTokenListing START ===');
    console.log('Input params:', {
      tokenUtxosCount: tokenUtxos.length,
      pricePerToken,
      tokensToList,
      tokenId,
      decimals,
      walletAddress,
      ownerAddress,
      isWalletInitialized
    });
    
    if (!isWalletInitialized || !walletAddress || !ownerAddress) {
      console.error('createTokenListing: Wallet validation failed', { isWalletInitialized, walletAddress, ownerAddress });
      toast({ variant: 'destructive', description: 'Wallet not initialized or addresses missing.', duration: 2000 });
      return { success: false };
    }

    const ordPkWIF = sessionStorage.getItem('ownerKey');
    const payPkWIF = sessionStorage.getItem('walletKey');
    
    console.log('createTokenListing: Keys check', { 
      hasOrdPk: !!ordPkWIF, 
      hasPayPk: !!payPkWIF,
      ordPkLength: ordPkWIF?.length,
      payPkLength: payPkWIF?.length
    });
    
    if (!ordPkWIF || !payPkWIF) {
      console.error('createTokenListing: Keys not found');
      toast({ variant: 'destructive', description: 'Wallet keys not found.', duration: 2000 });
      return { success: false };
    }

    if (tokenUtxos.length === 0) {
      console.error('createTokenListing: No token UTXOs provided');
      toast({ variant: 'destructive', description: 'No token UTXOs provided for listing.', duration: 2000 });
      return { success: false };
    }

    // Log each token UTXO
    console.log('createTokenListing: Token UTXOs:');
    tokenUtxos.forEach((utxo, i) => {
      console.log(`  UTXO ${i}:`, {
        txid: utxo.txid,
        vout: utxo.vout,
        amt: utxo.amt,
        scriptLength: utxo.script?.length,
        scriptPreview: utxo.script?.substring(0, 50) + '...'
      });
    });

    setIsCreatingListing(true);

    try {
      const { PrivateKey } = await loadBsvSdk();
      const { createOrdTokenListings, fetchPayUtxos, TokenType, oneSatBroadcaster } = await loadOrdModule();
      console.log('createTokenListing: Step 1 - Converting WIF to PrivateKey...');
      const ordPk = PrivateKey.fromWif(ordPkWIF);
      const payPk = PrivateKey.fromWif(payPkWIF);
      console.log('createTokenListing: Keys converted successfully');

      console.log('createTokenListing: Step 2 - Fetching payment UTXOs for', walletAddress);
      const paymentUtxos: Utxo[] = await fetchPayUtxos(walletAddress);
      console.log('createTokenListing: Payment UTXOs fetched:', {
        count: paymentUtxos?.length,
        totalSats: paymentUtxos?.reduce((sum, u) => sum + u.satoshis, 0)
      });
      
      if (!paymentUtxos || paymentUtxos.length === 0) {
        throw new Error('No payment UTXOs available for listing transaction');
      }

      console.log('createTokenListing: Step 3 - Preparing input tokens...');
      const inputTokens: TokenUtxo[] = tokenUtxos.map(utxo => ({
        txid: utxo.txid,
        vout: utxo.vout,
        satoshis: 1 as const,
        script: utxo.script,
        amt: utxo.amt,
        id: tokenId
      }));
      console.log('createTokenListing: Input tokens prepared:', inputTokens.length);

      const totalPrice = Math.round(pricePerToken * tokensToList);
      console.log('createTokenListing: Total price calculated:', totalPrice, 'sats');

      const listing: NewTokenListing = {
        payAddress: walletAddress,
        price: totalPrice,
        tokens: tokensToList,
        ordAddress: ownerAddress
      };
      console.log('createTokenListing: Step 4 - Listing config:', listing);

      const config: CreateOrdTokenListingsConfig = {
        utxos: paymentUtxos,
        listings: [listing],
        paymentPk: payPk,
        ordPk: ordPk,
        protocol: TokenType.BSV21,
        tokenID: tokenId,
        decimals: decimals,
        inputTokens: inputTokens,
        tokenChangeAddress: ownerAddress,
        satsPerKb: 100 // 0.1 sat/byte
      };
      console.log('createTokenListing: Step 5 - Full config prepared:', {
        utxosCount: config.utxos.length,
        listingsCount: config.listings.length,
        protocol: config.protocol,
        tokenID: config.tokenID,
        decimals: config.decimals,
        inputTokensCount: config.inputTokens.length,
        tokenChangeAddress: config.tokenChangeAddress
      });

      console.log('createTokenListing: Step 6 - Calling createOrdTokenListings...');
      const result = await createOrdTokenListings(config);
      console.log('createTokenListing: createOrdTokenListings returned:', {
        hasTx: !!result.tx,
        txId: result.tx?.id?.('hex'),
        resultKeys: Object.keys(result)
      });
      
      if (!result.tx) {
        console.error('createTokenListing: No transaction in result');
        throw new Error('Failed to create token listing transaction - no tx returned');
      }

      console.log('createTokenListing: Step 7 - Broadcasting transaction...');
      const broadcastResult = await result.tx.broadcast(oneSatBroadcaster());
      console.log('createTokenListing: Broadcast result:', JSON.stringify(broadcastResult, null, 2));
      
      // Check if broadcast was successful
      if (broadcastResult.status === 'error') {
        console.error('createTokenListing: Broadcast failed!', broadcastResult);
        throw new Error(`Broadcast failed: ${broadcastResult.description || broadcastResult.code || 'Unknown error'}`);
      }
      
      const txid = result.tx.id('hex');
      console.log('createTokenListing: SUCCESS! TXID:', txid);
      console.log('=== createTokenListing END (SUCCESS) ===');

      toast({
        description: `Token listing created! TXID: ${txid.substring(0, 8)}...`,
        duration: 4000,
      });

      return { success: true, txid };

    } catch (error) {
      console.error('=== createTokenListing ERROR ===');
      console.error('Error type:', (error as Error).constructor.name);
      console.error('Error message:', (error as Error).message);
      console.error('Error stack:', (error as Error).stack);
      console.error('Full error:', error);
      
      toast({
        variant: 'destructive',
        title: 'Token Listing Failed',
        description: `Failed to create token listing: ${(error as Error).message}`,
        duration: 4000,
      });
      return { success: false };
    } finally {
      setIsCreatingListing(false);
      console.log('createTokenListing: isCreatingListing set to false');
    }
  }, [isWalletInitialized, walletAddress, ownerAddress, toast]);

  // --- New Function: Purchase Token Listing (BSV21) ---
  const purchaseTokenListing = useCallback(async (
    listing: { txid: string; vout: number; amt: string; script: string; price: string; payout: string },
    tokenId: string
  ): Promise<{ success: boolean; txid?: string }> => {
    console.log('=== purchaseTokenListing START ===');
    console.log('Listing:', listing);
    console.log('Token ID:', tokenId);
    
    if (!isWalletInitialized || !walletAddress || !ownerAddress) {
      console.error('purchaseTokenListing: Wallet validation failed');
      toast({ variant: 'destructive', description: 'Wallet not initialized or addresses missing.', duration: 2000 });
      return { success: false };
    }

    const payPkWIF = sessionStorage.getItem('walletKey');
    
    if (!payPkWIF) {
      console.error('purchaseTokenListing: Payment key not found');
      toast({ variant: 'destructive', description: 'Wallet key not found.', duration: 2000 });
      return { success: false };
    }

    setIsPurchasingToken(true);

    try {
      const { PrivateKey } = await loadBsvSdk();
      const { purchaseOrdTokenListing, fetchPayUtxos, TokenType, oneSatBroadcaster } = await loadOrdModule();
      const payPk = PrivateKey.fromWif(payPkWIF);
      
      // Fetch payment UTXOs
      console.log('purchaseTokenListing: Fetching payment UTXOs...');
      const paymentUtxos: Utxo[] = await fetchPayUtxos(walletAddress);
      console.log('purchaseTokenListing: Payment UTXOs:', paymentUtxos?.length);
      
      if (!paymentUtxos || paymentUtxos.length === 0) {
        throw new Error('No payment UTXOs available for purchase');
      }

      // Convert listing to TokenUtxo format
      // payout is the base64-encoded payout script from the listing
      const listingUtxo: TokenUtxo = {
        txid: listing.txid,
        vout: listing.vout,
        satoshis: 1 as const,
        script: listing.script,
        amt: listing.amt,
        id: tokenId,
        price: parseInt(listing.price, 10),
        payout: listing.payout,
        isListing: true
      };

      console.log('purchaseTokenListing: Listing UTXO prepared:', listingUtxo);

      const config: PurchaseOrdTokenListingConfig = {
        protocol: TokenType.BSV21,
        tokenID: tokenId,
        utxos: paymentUtxos,
        paymentPk: payPk,
        listingUtxo: listingUtxo,
        ordAddress: ownerAddress,
        satsPerKb: 100
      };

      console.log('purchaseTokenListing: Calling purchaseOrdTokenListing...');
      const result = await purchaseOrdTokenListing(config);
      console.log('purchaseTokenListing: Result:', { hasTx: !!result.tx });
      
      if (!result.tx) {
        throw new Error('Failed to create purchase transaction');
      }

      console.log('purchaseTokenListing: Broadcasting transaction...');
      const broadcastResult = await result.tx.broadcast(oneSatBroadcaster());
      console.log('purchaseTokenListing: Broadcast result:', JSON.stringify(broadcastResult, null, 2));
      
      if (broadcastResult.status === 'error') {
        throw new Error(`Broadcast failed: ${broadcastResult.description || broadcastResult.code || 'Unknown error'}`);
      }
      
      const txid = result.tx.id('hex');
      console.log('purchaseTokenListing: SUCCESS! TXID:', txid);

      toast({
        description: `Purchase successful! TXID: ${txid.substring(0, 8)}...`,
        duration: 4000,
      });

      return { success: true, txid };

    } catch (error) {
      console.error('=== purchaseTokenListing ERROR ===');
      console.error('Error:', error);
      
      toast({
        variant: 'destructive',
        title: 'Purchase Failed',
        description: `Failed to purchase tokens: ${(error as Error).message}`,
        duration: 4000,
      });
      return { success: false };
    } finally {
      setIsPurchasingToken(false);
    }
  }, [isWalletInitialized, walletAddress, ownerAddress, toast]);

  // --- New Function: Cancel Token Listing (BSV21) ---
  const cancelTokenListing = useCallback(async (
    listing: { txid: string; vout: number; script: string; amt: string },
    tokenId: string
  ): Promise<{ success: boolean; txid?: string }> => {
    console.log('=== cancelTokenListing START ===');
    console.log('Listing:', listing);
    console.log('Token ID:', tokenId);
    
    if (!isWalletInitialized || !walletAddress || !ownerAddress) {
      console.error('cancelTokenListing: Wallet validation failed');
      toast({ variant: 'destructive', description: 'Wallet not initialized or addresses missing.', duration: 2000 });
      return { success: false };
    }

    const ordPkWIF = sessionStorage.getItem('ownerKey');
    const payPkWIF = sessionStorage.getItem('walletKey');
    
    if (!ordPkWIF || !payPkWIF) {
      console.error('cancelTokenListing: Keys not found');
      toast({ variant: 'destructive', description: 'Wallet keys not found.', duration: 2000 });
      return { success: false };
    }

    setIsCancellingTokenListing(true);

    try {
      const { PrivateKey } = await loadBsvSdk();
      const { cancelOrdTokenListings, fetchPayUtxos, TokenType, oneSatBroadcaster } = await loadOrdModule();
      const ordPk = PrivateKey.fromWif(ordPkWIF);
      const payPk = PrivateKey.fromWif(payPkWIF);
      
      // Fetch payment UTXOs
      console.log('cancelTokenListing: Fetching payment UTXOs...');
      const paymentUtxos: Utxo[] = await fetchPayUtxos(walletAddress);
      console.log('cancelTokenListing: Payment UTXOs:', paymentUtxos?.length);
      
      if (!paymentUtxos || paymentUtxos.length === 0) {
        throw new Error('No payment UTXOs available for cancellation');
      }

      // The listing UTXO with token-specific data
      const listingUtxos: TokenUtxo[] = [{
        txid: listing.txid,
        vout: listing.vout,
        satoshis: 1 as const, // Token listings are always 1 sat
        script: listing.script,
        amt: listing.amt,
        id: tokenId
      }];

      console.log('cancelTokenListing: Listing UTXO:', listingUtxos[0]);

      // Use cancelOrdTokenListings for BSV21 tokens (not cancelOrdListings)
      // This properly returns the tokens to the owner address
      const config: CancelOrdTokenListingsConfig = {
        protocol: TokenType.BSV21,
        utxos: paymentUtxos,
        listingUtxos: listingUtxos,
        ordPk: ordPk,
        paymentPk: payPk,
        tokenID: tokenId,
        ordAddress: ownerAddress, // Return tokens to owner
        satsPerKb: 100,
        additionalPayments: []
      };

      console.log('cancelTokenListing: Calling cancelOrdTokenListings...');
      const result = await cancelOrdTokenListings(config);
      console.log('cancelTokenListing: Result:', { hasTx: !!result.tx });
      
      if (!result.tx) {
        throw new Error('Failed to create cancellation transaction');
      }

      console.log('cancelTokenListing: Broadcasting transaction...');
      const broadcastResult = await result.tx.broadcast(oneSatBroadcaster());
      console.log('cancelTokenListing: Broadcast result:', JSON.stringify(broadcastResult, null, 2));
      
      if (broadcastResult.status === 'error') {
        throw new Error(`Broadcast failed: ${broadcastResult.description || broadcastResult.code || 'Unknown error'}`);
      }
      
      const txid = result.tx.id('hex');
      console.log('cancelTokenListing: SUCCESS! TXID:', txid);

      toast({
        description: `Listing cancelled! Tokens returned. TXID: ${txid.substring(0, 8)}...`,
        duration: 4000,
      });

      return { success: true, txid };

    } catch (error) {
      console.error('=== cancelTokenListing ERROR ===');
      console.error('Error:', error);
      
      toast({
        variant: 'destructive',
        title: 'Cancellation Failed',
        description: `Failed to cancel listing: ${(error as Error).message}`,
        duration: 4000,
      });
      return { success: false };
    } finally {
      setIsCancellingTokenListing(false);
    }
  }, [isWalletInitialized, walletAddress, ownerAddress, toast]);

  const contextValue: WalletContextProps = {
    // State
    isWalletInitialized,
    walletAddress, // Active payment address
    ownerAddress, // Active owner address
    profileOwnerAddress, // Profile owner address
    profilePaymentAddress, // Profile payment address
    profileOwnerKeyBip38,
    profilePaymentKeyBip38,
    profileUsername, // Profile username
    profileAvatarUrl, // Profile avatar URL
    walletBalance,
    confirmedBalance,
    unconfirmedBalance,
    unconfirmedTxs,
    bsvPrice,
    isPasskeySupported,
    isWalletReady: !!authUser && !!profileOwnerAddress && !!profilePaymentAddress && isWalletInitialized && ownerAddress === profileOwnerAddress && walletAddress === profilePaymentAddress && !isFetchingProfile,
    isLoading,
    isFetchingBalance,
    isSending,
    isCreating,
    isUnlocking,
    isFetchingProfile,
    isUpdatingProfile,
    isCreatingListing,
    activeCredentialId, // Expose active credential ID
    // Actions
    logout,
    fetchBalance,
    fetchDetailedBalance,
    createWallet,
    sendTransaction,
    prepareMintFundingOutputs,
    backupWallet,
    copyToClipboard,
    calculateUSDValue,
    fetchProfileAddresses, // Expose fetch
    unlinkProfileWallet, // Expose unlink action
    signAndFundTx, // Expose the new function
    getUtxosForOrdinalCreation, // Add the new function here
    saveEncryptedKeys,
    unlockWithPassword,
    createTokenListing, // Add BSV21 token listing function
    purchaseTokenListing, // Add BSV21 token purchase function
    cancelTokenListing, // Add BSV21 token listing cancellation function
    isPurchasingToken, // Token purchase loading state
    isCancellingTokenListing, // Token listing cancellation loading state
  };

  return (
    <WalletContext.Provider value={contextValue}>
      {children}
    </WalletContext.Provider>
  );
};

export const useWallet = (): WalletContextProps => {
  const context = useContext(WalletContext);
  if (context === undefined) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
};