const AUTH_STORAGE_KEY = 'passkeys:auth:v2'
const WALLET_STORAGE_KEY = 'passkeys:wallet:v2'

const OLD_TEST_STORAGE_KEYS = [
  'authCredentials',
  'walletUnlockPasskeys',
  'walletCredentials',
  '_tmp_wallet_pw',
  '_tmp_wallet_pw_enc',
  '_tmp_wallet_pw_nonce',
]

const PASSKEY_TIMEOUT_MS = 60_000
const CHALLENGE_BYTES = 32
const PRF_SALT_BYTES = 32
const AES_GCM_IV_BYTES = 12
const APP_NAME = process.env.NEXT_PUBLIC_APP_NAME || 'bitcoin'

type AuthPayload = {
  email: string
  password: string
  name: string
}

type WalletPayload = {
  ownerAddress: string
  password: string
  name: string
}

type BaseStoredPasskeyRecord = {
  version: 2
  id: string
  createdAt: number
  prfSalt: string
  iv: string
  ciphertext: string
}

type StoredAuthCredential = BaseStoredPasskeyRecord & {
  email: string
  name: string
}

type StoredWalletPasskey = BaseStoredPasskeyRecord & {
  ownerAddress: string
  name: string
}

type StoredPasskeyMap<T> = Record<string, T>

type PrfClientExtensionResults = {
  prf?: {
    enabled?: boolean
    results?: {
      first?: ArrayBuffer
      second?: ArrayBuffer
    }
  }
}

function hasWindow() {
  return typeof window !== 'undefined'
}

function getRpId() {
  if (!hasWindow()) {
    throw new Error('Passkeys are only available in the browser')
  }

  return window.location.hostname
}

function randomBytes(length: number) {
  return crypto.getRandomValues(new Uint8Array(length))
}

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4))
  const binary = atob(normalized + padding)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes
}

function encodeText(value: string) {
  return new TextEncoder().encode(value)
}

function decodeText(value: ArrayBuffer) {
  return new TextDecoder().decode(value)
}

function createPasskeyChallenge() {
  return randomBytes(CHALLENGE_BYTES)
}

function createPrfSalt() {
  return randomBytes(PRF_SALT_BYTES)
}

async function importWrappingKey(prfOutput: ArrayBuffer) {
  return crypto.subtle.importKey(
    'raw',
    prfOutput,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  )
}

async function encryptPayload(payload: string, prfOutput: ArrayBuffer) {
  const iv = randomBytes(AES_GCM_IV_BYTES)
  const key = await importWrappingKey(prfOutput)
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encodeText(payload)
  )

  return {
    iv: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)),
  }
}

async function decryptPayload(ciphertext: string, iv: string, prfOutput: ArrayBuffer) {
  const key = await importWrappingKey(prfOutput)
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64UrlToBytes(iv) },
    key,
    base64UrlToBytes(ciphertext)
  )

  return decodeText(plaintext)
}

function readStore<T>(storageKey: string): StoredPasskeyMap<T> {
  if (!hasWindow()) {
    return {}
  }

  try {
    const raw = localStorage.getItem(storageKey)
    if (!raw) {
      return {}
    }

    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed as StoredPasskeyMap<T> : {}
  } catch {
    return {}
  }
}

function writeStore<T>(storageKey: string, value: StoredPasskeyMap<T>) {
  if (!hasWindow()) {
    return
  }

  localStorage.setItem(storageKey, JSON.stringify(value))
}

function removeFromStore<T>(storageKey: string, id: string) {
  const current = readStore<T>(storageKey)
  if (!current[id]) {
    return false
  }

  delete current[id]

  if (Object.keys(current).length === 0) {
    localStorage.removeItem(storageKey)
  } else {
    writeStore(storageKey, current)
  }

  return true
}

function isLikelyPrfCapableBrowser() {
  if (!hasWindow()) {
    return false
  }

  const userAgent = window.navigator.userAgent
  const chromium = userAgent.match(/(?:Chrome|Chromium|Edg)\/(\d+)/)
  if (chromium) {
    return Number.parseInt(chromium[1] ?? '0', 10) >= 128
  }

  if (/Safari/.test(userAgent) && !/Chrome|Chromium|Edg/.test(userAgent)) {
    const safari = userAgent.match(/Version\/(\d+)/)
    return Number.parseInt(safari?.[1] ?? '0', 10) >= 18
  }

  return false
}

function ensureBrowserSupport() {
  if (!isPasskeyAvailable()) {
    throw new Error('This browser does not support secure passkey storage for this app yet.')
  }
}

function getCreatePrfResult(credential: PublicKeyCredential) {
  const extensionResults = credential.getClientExtensionResults() as PrfClientExtensionResults
  const first = extensionResults.prf?.results?.first

  if (extensionResults.prf?.enabled && first instanceof ArrayBuffer) {
    return first
  }

  return null
}

function getGetPrfResult(credential: PublicKeyCredential) {
  const extensionResults = credential.getClientExtensionResults() as PrfClientExtensionResults
  const first = extensionResults.prf?.results?.first

  if (first instanceof ArrayBuffer) {
    return first
  }

  return null
}

function getAllowCredentials<T extends BaseStoredPasskeyRecord>(records: T[]) {
  return records.map((record) => ({
    id: base64UrlToBytes(record.id),
    type: 'public-key' as const,
  }))
}

function getPrfEvalByCredential<T extends BaseStoredPasskeyRecord>(records: T[]) {
  return Object.fromEntries(
    records.map((record) => [
      record.id,
      {
        first: base64UrlToBytes(record.prfSalt),
      },
    ])
  )
}

function getCreateCredentialOptions(userName: string, displayName: string, prfSalt: Uint8Array): PublicKeyCredentialCreationOptions {
  return {
    challenge: createPasskeyChallenge(),
    rp: {
      name: APP_NAME,
      id: getRpId(),
    },
    user: {
      id: randomBytes(32),
      name: userName,
      displayName,
    },
    pubKeyCredParams: [
      { alg: -7, type: 'public-key' },
      { alg: -257, type: 'public-key' },
    ],
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      residentKey: 'required',
      userVerification: 'required',
    },
    timeout: PASSKEY_TIMEOUT_MS,
    extensions: {
      credProps: true,
      prf: {
        eval: {
          first: prfSalt,
        },
      },
    } as AuthenticationExtensionsClientInputs,
  }
}

function getRequestOptions<T extends BaseStoredPasskeyRecord>(records: T[]): PublicKeyCredentialRequestOptions {
  return {
    challenge: createPasskeyChallenge(),
    allowCredentials: getAllowCredentials(records),
    userVerification: 'required',
    timeout: PASSKEY_TIMEOUT_MS,
    rpId: getRpId(),
    extensions: {
      prf: {
        evalByCredential: getPrfEvalByCredential(records),
      },
    } as AuthenticationExtensionsClientInputs,
  }
}

async function createStoredSecret<T extends BaseStoredPasskeyRecord>(
  options: PublicKeyCredentialCreationOptions,
  createRecord: (credentialId: string, prfSalt: string, iv: string, ciphertext: string) => T,
  payload: string,
  storageKey: string
) {
  const credential = await navigator.credentials.create({ publicKey: options }) as PublicKeyCredential | null

  if (!credential) {
    throw new Error('Failed to create passkey')
  }

  const prfOutput = getCreatePrfResult(credential)
  if (!prfOutput) {
    throw new Error('This passkey was created, but your browser could not provide the secure key material needed to save secrets.')
  }

  const prfSalt = (options.extensions as { prf: { eval: { first: Uint8Array } } }).prf.eval.first
  const { iv, ciphertext } = await encryptPayload(payload, prfOutput)
  const record = createRecord(credential.id, bytesToBase64Url(prfSalt), iv, ciphertext)

  const current = readStore<T>(storageKey)
  current[credential.id] = record
  writeStore(storageKey, current)

  return credential.id
}

async function readStoredSecret<T extends BaseStoredPasskeyRecord>(
  records: T[],
  storageKey: string
) {
  const assertion = await navigator.credentials.get({
    publicKey: getRequestOptions(records),
  }) as PublicKeyCredential | null

  if (!assertion) {
    throw new Error('Failed to verify passkey')
  }

  const current = readStore<T>(storageKey)
  const selectedRecord = current[assertion.id]

  if (!selectedRecord) {
    throw new Error('Selected passkey is no longer stored on this device')
  }

  const prfOutput = getGetPrfResult(assertion)
  if (!prfOutput) {
    throw new Error('This browser could not recover the secure key material for the selected passkey')
  }

  return decryptPayload(selectedRecord.ciphertext, selectedRecord.iv, prfOutput)
}

function getAuthStore() {
  return readStore<StoredAuthCredential>(AUTH_STORAGE_KEY)
}

function getWalletStore() {
  return readStore<StoredWalletPasskey>(WALLET_STORAGE_KEY)
}

function sortByNewest<T extends { createdAt: number }>(values: T[]) {
  return values.toSorted((left, right) => right.createdAt - left.createdAt)
}

export function isPasskeyAvailable() {
  return hasWindow() && window.isSecureContext && 'PublicKeyCredential' in window && 'credentials' in window.navigator && isLikelyPrfCapableBrowser()
}

export function cleanupOldPasskeyTestData() {
  if (!hasWindow()) {
    return false
  }

  let changed = false

  for (const key of OLD_TEST_STORAGE_KEYS) {
    if (localStorage.getItem(key) !== null || sessionStorage.getItem(key) !== null) {
      localStorage.removeItem(key)
      sessionStorage.removeItem(key)
      changed = true
    }
  }

  return changed
}

export async function createAuthPasskey(authData: AuthPayload) {
  ensureBrowserSupport()

  const resolvedName = authData.name.trim() || authData.email
  const prfSalt = createPrfSalt()

  return createStoredSecret(
    getCreateCredentialOptions(authData.email, resolvedName, prfSalt),
    (credentialId, storedPrfSalt, iv, ciphertext) => ({
      version: 2,
      id: credentialId,
      createdAt: Date.now(),
      prfSalt: storedPrfSalt,
      iv,
      ciphertext,
      email: authData.email,
      name: resolvedName,
    }),
    JSON.stringify({
      email: authData.email,
      password: authData.password,
      name: resolvedName,
    }),
    AUTH_STORAGE_KEY
  )
}

export function getAuthPasskeys() {
  return sortByNewest(Object.values(getAuthStore())).map((record) => ({
    id: record.id,
    email: record.email,
    name: record.name,
    createdAt: record.createdAt,
  }))
}

export async function getAuthPasskey(credentialId?: string): Promise<AuthPayload> {
  ensureBrowserSupport()

  const records = credentialId
    ? Object.values(getAuthStore()).filter((record) => record.id === credentialId)
    : Object.values(getAuthStore())

  if (records.length === 0) {
    throw new Error('No saved auth passkeys are available on this device')
  }

  const payload = await readStoredSecret(records, AUTH_STORAGE_KEY)
  return JSON.parse(payload) as AuthPayload
}

export function removeAuthPasskey(credentialId: string) {
  return removeFromStore<StoredAuthCredential>(AUTH_STORAGE_KEY, credentialId)
}

export async function createWalletPasskey(data: WalletPayload) {
  ensureBrowserSupport()

  const resolvedName = data.name.trim() || `wallet-${data.ownerAddress.slice(0, 8)}`
  const prfSalt = createPrfSalt()

  return createStoredSecret(
    getCreateCredentialOptions(resolvedName, resolvedName, prfSalt),
    (credentialId, storedPrfSalt, iv, ciphertext) => ({
      version: 2,
      id: credentialId,
      createdAt: Date.now(),
      prfSalt: storedPrfSalt,
      iv,
      ciphertext,
      ownerAddress: data.ownerAddress,
      name: resolvedName,
    }),
    JSON.stringify({
      ownerAddress: data.ownerAddress,
      password: data.password,
      name: resolvedName,
    }),
    WALLET_STORAGE_KEY
  )
}

export function hasWalletPasskey(ownerAddress: string) {
  return Object.values(getWalletStore()).some((record) => record.ownerAddress === ownerAddress)
}

export function getWalletPasskeysForAddress(ownerAddress: string) {
  return sortByNewest(
    Object.values(getWalletStore()).filter((record) => record.ownerAddress === ownerAddress)
  ).map((record) => ({
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
  }))
}

export async function getWalletPasskey(ownerAddress?: string): Promise<{ password: string; ownerAddress: string }> {
  ensureBrowserSupport()

  const records = ownerAddress
    ? Object.values(getWalletStore()).filter((record) => record.ownerAddress === ownerAddress)
    : Object.values(getWalletStore())

  if (records.length === 0) {
    throw new Error('No saved wallet passkeys are available on this device')
  }

  const payload = await readStoredSecret(records, WALLET_STORAGE_KEY)
  const parsed = JSON.parse(payload) as WalletPayload

  return {
    password: parsed.password,
    ownerAddress: parsed.ownerAddress,
  }
}

export function removeWalletPasskey(credentialId: string) {
  return removeFromStore<StoredWalletPasskey>(WALLET_STORAGE_KEY, credentialId)
}
