'use client'

type LogLevel = 'log' | 'warn' | 'error'

let installed = false

function serializeArguments(args: unknown[]): unknown[] {
  const seen = new WeakSet<object>()
  const json = JSON.stringify(args, (_key, value: unknown) => {
    if (typeof value === 'bigint') return value.toString()
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        stack: value.stack,
      }
    }
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]'
      seen.add(value)
    }
    return value
  })

  return JSON.parse(json) as unknown[]
}

function isMintLog(args: unknown[]): boolean {
  return typeof args[0] === 'string' && args[0].startsWith('[mint-beef]')
}

export function installMintLogCapture(): void {
  if (installed || typeof window === 'undefined') return
  if (process.env.NODE_ENV !== 'development') return
  installed = true

  const methods: LogLevel[] = ['log', 'warn', 'error']
  const mutableConsole = console as unknown as Record<
    LogLevel,
    (...args: unknown[]) => void
  >

  for (const level of methods) {
    const original = mutableConsole[level].bind(console)
    mutableConsole[level] = (...args: unknown[]) => {
      original(...args)
      if (!isMintLog(args)) return

      let serializedArgs: unknown[]
      try {
        serializedArgs = serializeArguments(args)
      } catch {
        serializedArgs = [String(args[0]), '[Unserializable log arguments]']
      }

      void fetch('/api/mint-logs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          capturedAt: new Date().toISOString(),
          level,
          page: window.location.href,
          args: serializedArgs,
        }),
        keepalive: true,
      }).catch(() => {
        // Logging must never interrupt a mint.
      })
    }
  }
}
