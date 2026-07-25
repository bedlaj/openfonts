'use strict'

const fs = require('node:fs')
const path = require('node:path')
const {execFile} = require('node:child_process')
const {promisify} = require('node:util')

const execFileAsync = promisify(execFile)

const RETRIES = Number(process.env.OPENFONTS_PUBLISH_RETRIES || 6)
const BASE_BACKOFF_MS = Number(process.env.OPENFONTS_PUBLISH_BACKOFF_MS || 15000)
const MAX_BACKOFF_MS = 300000
const MAX_GAP_MS = 20000
const MIN_GAP_MS = 250

// npm rate-limits publishes per account, aggressively and without documented
// numbers. Real PUTs are therefore serialized behind one queue with an adaptive
// gap: every 429 widens it, sustained successes narrow it again. Builds still
// run concurrently — only the upload is single-file.
const gate = {chain: Promise.resolve(), gap: MIN_GAP_MS, nextAt: 0, streak: 0}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function isRateLimited(output) {
  return /\bE429\b|429 Too Many Requests/i.test(output)
}

// npm prints "Retry-After: <seconds>" only sometimes; honour it when present.
function retryAfterMs(output) {
  const m = /retry-?after[":\s]+(\d+)/i.exec(output)
  if (!m) return null
  const seconds = Number(m[1])
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, MAX_BACKOFF_MS) : null
}

function enqueue(task) {
  const run = gate.chain.then(task, task)
  gate.chain = run.then(() => {}, () => {})
  return run
}

async function waitForSlot() {
  const wait = gate.nextAt - Date.now()
  if (wait > 0) await sleep(wait)
}

function noteRateLimited() {
  gate.streak = 0
  gate.gap = Math.min(MAX_GAP_MS, gate.gap * 2 + 500)
}

function noteSuccess() {
  gate.streak++
  if (gate.streak >= 20 && gate.gap > MIN_GAP_MS) {
    gate.gap = Math.max(MIN_GAP_MS, Math.floor(gate.gap / 2))
    gate.streak = 0
  }
}

// Rewrite an already-built package dir to publish under a test scope
// (e.g. "@openfonts-test"). Done as the very last step so everything else
// about the build — including versions computed from the real @openfonts
// registry — stays a faithful rehearsal.
function applyScope(dir, scope) {
  const pkgPath = path.join(dir, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  pkg.name = pkg.name.replace(/^@openfonts\//, `${scope}/`)
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  const readmePath = path.join(dir, 'README.md')
  const readme = fs.readFileSync(readmePath, 'utf8')
  fs.writeFileSync(readmePath, readme.replaceAll('@openfonts/', `${scope}/`))
}

async function runNpmPublish(dir, dryRun) {
  const args = ['publish', '--ignore-scripts', '--fetch-retries=4', '--fetch-retry-mintimeout=10000', '--fetch-retry-maxtimeout=120000']
  if (dryRun) args.push('--dry-run')
  try {
    const {stdout, stderr} = await execFileAsync('npm', args, {cwd: dir, timeout: 900000, maxBuffer: 32 * 1024 * 1024})
    return {ok: true, output: (stdout + stderr).trim()}
  } catch (error) {
    return {ok: false, output: `${error.stdout || ''}${error.stderr || ''}`.trim() || error.message}
  }
}

function publishError(dir, output) {
  const err = new Error(`npm publish failed in ${dir}: ${output}`)
  err.isDuplicateVersion = /cannot publish over|previously published versions/i.test(output)
  err.isRateLimited = isRateLimited(output)
  return err
}

// Run `npm publish` (or --dry-run) in a built package dir.
// Returns {published: bool, dryRun: bool, output}.
async function publishPackage(dir, {dryRun = true, scope = null} = {}) {
  if (scope) applyScope(dir, scope)

  // Dry runs never hit the publish endpoint, so they skip the queue entirely —
  // serializing 6,600 of them would add hours to every verification run.
  if (dryRun) {
    const {ok, output} = await runNpmPublish(dir, true)
    if (!ok) throw publishError(dir, output)
    return {published: false, dryRun: true, output}
  }

  return enqueue(async () => {
    let lastOutput = ''
    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      await waitForSlot()
      const started = Date.now()
      const {ok, output} = await runNpmPublish(dir, false)
      lastOutput = output
      gate.nextAt = Date.now() + gate.gap
      if (ok) {
        noteSuccess()
        return {published: true, dryRun: false, output}
      }
      if (!isRateLimited(output) || attempt === RETRIES) break
      noteRateLimited()
      const backoff = retryAfterMs(output) ?? Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt)
      const jitter = Math.floor(backoff * 0.2 * ((started % 1000) / 1000))
      console.log(`rate limited publishing ${path.basename(path.dirname(dir))}, backing off ${Math.round((backoff + jitter) / 1000)}s (attempt ${attempt + 1}/${RETRIES})`)
      gate.nextAt = Date.now() + backoff + jitter
    }
    throw publishError(dir, lastOutput)
  })
}

module.exports = {publishPackage, applyScope}
