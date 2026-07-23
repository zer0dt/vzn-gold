import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdir, symlink, unlink, writeFile } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const timestamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d{3}Z$/, 'Z')
const runsRoot = path.join(projectRoot, 'logs', 'mint-runs')
const runDir = path.join(runsRoot, timestamp)
const overlayDir =
  process.env.BSV21_OVERLAY_DIR ??
  path.resolve(projectRoot, '..', '..', 'bsv21', 'bsv21-overlay')

await mkdir(runDir, { recursive: true })
await writeFile(
  path.join(runDir, 'run.json'),
  `${JSON.stringify(
    {
      startedAt: new Date().toISOString(),
      projectRoot,
      overlayDir,
      node: process.version,
    },
    null,
    2
  )}\n`
)

const latestLink = path.join(runsRoot, 'latest')
await unlink(latestLink).catch((error) => {
  if (error?.code !== 'ENOENT') throw error
})
await symlink(timestamp, latestLink)

const children = []
let stopping = false

function startProcess(name, command, args, options, logFilename) {
  const logStream = createWriteStream(path.join(runDir, logFilename), { flags: 'a' })
  const child = spawn(command, args, {
    ...options,
    env: {
      ...process.env,
      MINT_LOG_DIR: runDir,
      ...options.env,
    },
    stdio: ['inherit', 'pipe', 'pipe'],
  })

  child.stdout.pipe(logStream, { end: false })
  child.stderr.pipe(logStream, { end: false })
  child.stdout.pipe(process.stdout, { end: false })
  child.stderr.pipe(process.stderr, { end: false })

  child.on('error', (error) => {
    console.error(`[local:logs] ${name} failed to start`, error)
    stopAll(1)
  })
  child.on('close', (code, signal) => {
    logStream.end()
    if (!stopping) {
      console.error(
        `[local:logs] ${name} stopped unexpectedly (${signal ?? `exit ${code ?? 1}`})`
      )
      stopAll(code ?? 1)
    }
  })

  children.push(child)
}

function stopAll(exitCode = 0) {
  if (stopping) return
  stopping = true
  for (const child of children) {
    if (!child.killed) child.kill('SIGTERM')
  }
  setTimeout(() => process.exit(exitCode), 750).unref()
}

console.log(`[local:logs] saving this run to ${runDir}`)

if (process.env.SKIP_OVERLAY !== '1') {
  const overlayBinary = path.join(overlayDir, 'bsv21')
  await access(overlayBinary, constants.X_OK)
  startProcess(
    'overlay',
    overlayBinary,
    ['server', '--port=3005', '--sync'],
    { cwd: overlayDir },
    'overlay.log'
  )
}

startProcess(
  'Next.js',
  process.platform === 'win32' ? 'npm.cmd' : 'npm',
  ['run', 'dev'],
  { cwd: projectRoot },
  'next.log'
)

process.on('SIGINT', () => stopAll(0))
process.on('SIGTERM', () => stopAll(0))
