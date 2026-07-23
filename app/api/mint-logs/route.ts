import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const MAX_LOG_BODY_BYTES = 64 * 1024
const fallbackSession = `manual-${new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z')}`
const mintWriteQueues = new Map<string, Promise<void>>()

type MintLogEntry = {
  receivedAt: string
  entry: {
    capturedAt?: string
    level?: string
    page?: string
    mintId?: string
    args?: unknown[]
  }
}

function getLogDirectory(): string {
  return (
    process.env.MINT_LOG_DIR ??
    path.join(process.cwd(), 'logs', 'mint-runs', fallbackSession)
  )
}

function getMintId(entry: MintLogEntry['entry']): string | null {
  if (typeof entry.mintId === 'string' && entry.mintId.trim()) {
    return entry.mintId.trim()
  }

  const details = entry.args?.[1]
  if (
    typeof details === 'object' &&
    details !== null &&
    'mintId' in details &&
    typeof details.mintId === 'string'
  ) {
    return details.mintId
  }

  return null
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function getDetails(log: MintLogEntry): Record<string, unknown> {
  const details = log.entry.args?.[1]
  return typeof details === 'object' && details !== null
    ? (details as Record<string, unknown>)
    : {}
}

function getTiming(details: Record<string, unknown>): Record<string, unknown> {
  return typeof details.timing === 'object' && details.timing !== null
    ? (details.timing as Record<string, unknown>)
    : {}
}

function renderReport(mintId: string, logs: MintLogEntry[]): string {
  const orderedLogs = [...logs].sort((a, b) =>
    String(a.entry.capturedAt ?? a.receivedAt).localeCompare(
      String(b.entry.capturedAt ?? b.receivedAt)
    )
  )
  const labels = orderedLogs.map((log) => String(log.entry.args?.[0] ?? 'Mint event'))
  const details = orderedLogs.map(getDetails)
  const totalMs = Math.max(
    0,
    ...details.map((item) => Number(getTiming(item).totalMs ?? 0))
  )
  const completed = labels.some((label) => label.includes('mint complete'))
  const failed = orderedLogs.some(
    (log, index) =>
      log.entry.level === 'error' ||
      labels[index].includes('failed') ||
      labels[index].includes('threw')
  )
  const status = failed ? 'Failed' : completed ? 'Complete' : 'In progress'
  const statusClass = failed ? 'failed' : completed ? 'complete' : 'running'
  const txid = details.findLast((item) => typeof item.txid === 'string')?.txid
  const startedAt =
    details.find((item) => typeof item.startedAt === 'string')?.startedAt ??
    orderedLogs[0]?.entry.capturedAt ??
    orderedLogs[0]?.receivedAt

  const waits = orderedLogs
    .map((log, index) => ({
      label: labels[index].replace('[mint-beef] ', ''),
      ms: Number(getTiming(details[index]).sinceLastMs ?? 0),
    }))
    .filter((wait) => wait.ms > 0)
    .sort((a, b) => b.ms - a.ms)
    .slice(0, 5)

  const timelineRows = orderedLogs
    .map((log, index) => {
      const timing = getTiming(details[index])
      const detailJson = JSON.stringify(details[index], null, 2)
      return `<tr>
        <td>${escapeHtml(log.entry.capturedAt ?? log.receivedAt)}</td>
        <td>${escapeHtml(labels[index].replace('[mint-beef] ', ''))}</td>
        <td>${escapeHtml(timing.sinceLastMs ?? '—')}</td>
        <td>${escapeHtml(timing.totalMs ?? '—')}</td>
        <td><details><summary>Details</summary><pre>${escapeHtml(detailJson)}</pre></details></td>
      </tr>`
    })
    .join('\n')

  const waitRows =
    waits.length > 0
      ? waits
          .map(
            (wait) =>
              `<li><strong>${escapeHtml(wait.ms)} ms</strong> — ${escapeHtml(wait.label)}</li>`
          )
          .join('')
      : '<li>Waiting for timing data.</li>'

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mint report ${escapeHtml(mintId)}</title>
  <style>
    :root { color-scheme: dark; font-family: ui-sans-serif, system-ui, sans-serif; }
    body { margin: 0; padding: 32px; background: #0b0d10; color: #e8eaed; }
    main { max-width: 1200px; margin: auto; }
    h1 { margin-bottom: 6px; } .muted { color: #9aa0a6; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin: 24px 0; }
    .card { padding: 16px; border: 1px solid #30343b; border-radius: 12px; background: #14171c; overflow-wrap: anywhere; }
    .value { display: block; margin-top: 8px; font-size: 1.25rem; font-weight: 700; }
    .complete { color: #63d297; } .failed { color: #ff7b72; } .running { color: #f2cc60; }
    section { margin: 28px 0; } table { width: 100%; border-collapse: collapse; font-size: 14px; }
    th, td { padding: 10px; border-bottom: 1px solid #30343b; text-align: left; vertical-align: top; }
    th { color: #9aa0a6; } pre { max-width: 580px; overflow: auto; white-space: pre-wrap; color: #c9d1d9; }
    li { margin: 8px 0; }
  </style>
</head>
<body>
<main>
  <h1>Mint performance report</h1>
  <div class="muted">Generated ${escapeHtml(new Date().toISOString())}</div>
  <div class="cards">
    <div class="card">Status<span class="value ${statusClass}">${status}</span></div>
    <div class="card">Total time<span class="value">${totalMs ? `${(totalMs / 1000).toFixed(2)} s` : '—'}</span></div>
    <div class="card">Events<span class="value">${orderedLogs.length}</span></div>
    <div class="card">Started<span class="value">${escapeHtml(startedAt ?? '—')}</span></div>
    <div class="card">Transaction<span class="value">${escapeHtml(txid ?? 'Pending')}</span></div>
    <div class="card">Mint ID<span class="value">${escapeHtml(mintId)}</span></div>
  </div>
  <section>
    <h2>Largest observed waits</h2>
    <ol>${waitRows}</ol>
  </section>
  <section>
    <h2>Timeline</h2>
    <table>
      <thead><tr><th>Time</th><th>Event</th><th>Since previous (ms)</th><th>Total (ms)</th><th>Data</th></tr></thead>
      <tbody>${timelineRows}</tbody>
    </table>
  </section>
</main>
</body>
</html>
`
}

async function persistMintLog(mintId: string, log: MintLogEntry): Promise<void> {
  const safeMintId = mintId.replace(/[^a-zA-Z0-9_-]/g, '_')
  const mintDirectory = path.join(getLogDirectory(), 'mints', safeMintId)
  const jsonPath = path.join(mintDirectory, 'mint.log')
  const temporaryJsonPath = `${jsonPath}.tmp`
  await mkdir(mintDirectory, { recursive: true })

  let logs: MintLogEntry[] = []
  try {
    logs = JSON.parse(await readFile(jsonPath, 'utf8')) as MintLogEntry[]
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  logs.push(log)

  await writeFile(temporaryJsonPath, `${JSON.stringify(logs, null, 2)}\n`, 'utf8')
  await rename(temporaryJsonPath, jsonPath)
  await writeFile(path.join(mintDirectory, 'report.html'), renderReport(mintId, logs), 'utf8')
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get('content-length') ?? 0)
  if (contentLength > MAX_LOG_BODY_BYTES) {
    return NextResponse.json({ error: 'Log entry is too large' }, { status: 413 })
  }

  try {
    const entry = (await request.json()) as MintLogEntry['entry']
    const log: MintLogEntry = {
      receivedAt: new Date().toISOString(),
      entry,
    }
    const serialized = JSON.stringify(log)

    if (Buffer.byteLength(serialized) > MAX_LOG_BODY_BYTES) {
      return NextResponse.json({ error: 'Log entry is too large' }, { status: 413 })
    }

    const mintId = getMintId(entry)
    if (!mintId) {
      return NextResponse.json({ error: 'Missing mint ID' }, { status: 400 })
    }

    const previousWrite = mintWriteQueues.get(mintId) ?? Promise.resolve()
    const currentWrite = previousWrite
      .catch(() => undefined)
      .then(() => persistMintLog(mintId, log))
    mintWriteQueues.set(mintId, currentWrite)
    await currentWrite
    if (mintWriteQueues.get(mintId) === currentWrite) {
      mintWriteQueues.delete(mintId)
    }

    return new NextResponse(null, { status: 204 })
  } catch (error) {
    console.error('[mint-logs] failed to persist browser log', error)
    return NextResponse.json({ error: 'Could not persist mint log' }, { status: 500 })
  }
}
