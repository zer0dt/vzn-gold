const TEMP_SECRET_TTL_MS = 90_000

let tempSecretState: { value: string; expiresAt: number } | null = null

function isExpired() {
  return !tempSecretState || tempSecretState.expiresAt <= Date.now()
}

export async function storeTempPassword(password: string) {
  tempSecretState = {
    value: password,
    expiresAt: Date.now() + TEMP_SECRET_TTL_MS,
  }
}

export async function retrieveTempPassword() {
  if (isExpired()) {
    tempSecretState = null
    return null
  }

  return tempSecretState?.value ?? null
}

export function clearTempPassword() {
  tempSecretState = null
}

export function hasTempPassword() {
  if (isExpired()) {
    tempSecretState = null
    return false
  }

  return true
}

export function installTempPasswordLifecycleGuards() {
  if (typeof window === 'undefined') {
    return () => {}
  }

  const clear = () => {
    clearTempPassword()
  }

  window.addEventListener('pagehide', clear)
  window.addEventListener('beforeunload', clear)

  return () => {
    window.removeEventListener('pagehide', clear)
    window.removeEventListener('beforeunload', clear)
  }
}
