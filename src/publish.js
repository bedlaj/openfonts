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
// A Retry-After above this means the account is done for now, not briefly
// throttled - defer the package instead of sleeping the job timeout away.
const RETRY_AFTER_GIVE_UP_MS = Number(process.env.OPENFONTS_RETRY_AFTER_GIVE_UP_MS || 600000)
const REGISTRY = process.env.OPENFONTS_REGISTRY || 'https://registry.npmjs.org'

// npm rate-limits publishes per account, aggressively and without documented
// numbers. Real PUTs are therefore serialized behind one queue with an adaptive
// gap: every 429 widens it, sustained successes narrow it again. Builds still
// run concurrently — only the upload is single-file.
const gate = {chain: Promise.resolve(), gap: MIN_GAP_MS, nextAt: 0, streak: 0}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function isRateLimited(output) {
  return /\bE429\b|429 Too Many Requests/i.test(output)
}

// The npm CLI never surfaces response headers, but the registry's 429 carries a
// Retry-After header (served by Cloudflare's edge limiter, before npm's app sees
// the request). Probe the same URL with an authenticated PUT whose body could
// never be a valid publish - if the limiter is still active it answers 429 with
// Retry-After; anything else means it has lifted.
// Returns {limited, retryAfterMs} or null when the probe is unavailable/failed.
async function probeRetryAfter(pkgName) {
  const token = process.env.NODE_AUTH_TOKEN || process.env.NPM_TOKEN
  if (!token || typeof globalThis.fetch !== 'function') return null
  try {
    const res = await globalThis.fetch(`${REGISTRY}/${pkgName.replace('/', '%2F')}`, {
      method: 'PUT',
      headers: {authorization: `Bearer ${token}`, 'content-type': 'application/json'},
      body: '{}',
      signal: AbortSignal.timeout(30000),
    })
    await res.arrayBuffer().catch(() => {})
    if (res.status !== 429) return {limited: false, retryAfterMs: null}
    const seconds = Number(res.headers.get('retry-after'))
    return {limited: true, retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null}
  } catch {
    return null
  }
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
    const pkgName = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).name
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
      // npm can commit the write and still fail the response (429, dropped
      // connection). The retry then sees its own upload as a duplicate — that
      // is this attempt succeeding late, not a conflict with someone else.
      if (attempt > 0 && /cannot publish over|previously published versions/i.test(output)) {
        noteSuccess()
        return {published: true, dryRun: false, output, landedOnEarlierAttempt: true}
      }
      if (!isRateLimited(output) || attempt === RETRIES) break
      noteRateLimited()

      const probe = await probeRetryAfter(pkgName)
      let backoff
      if (probe && !probe.limited) {
        // Limiter already lifted (the npm attempt raced its tail end).
        backoff = 2000
        console.log(`rate limit on ${pkgName} has lifted, retrying (attempt ${attempt + 1}/${RETRIES})`)
      } else if (probe && probe.retryAfterMs != null) {
        if (probe.retryAfterMs > RETRY_AFTER_GIVE_UP_MS) {
          const err = publishError(dir, `${lastOutput}\nregistry Retry-After is ${Math.round(probe.retryAfterMs / 1000)}s - deferring instead of waiting`)
          err.isRateLimited = true
          err.retryAfterMs = probe.retryAfterMs
          throw err
        }
        backoff = probe.retryAfterMs + 1000
        console.log(`rate limited publishing ${pkgName}, registry says retry after ${Math.round(probe.retryAfterMs / 1000)}s (attempt ${attempt + 1}/${RETRIES})`)
      } else {
        backoff = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt)
        const jitter = Math.floor(backoff * 0.2 * ((started % 1000) / 1000))
        backoff += jitter
        console.log(`rate limited publishing ${pkgName}, backing off ${Math.round(backoff / 1000)}s (attempt ${attempt + 1}/${RETRIES})`)
      }
      gate.nextAt = Date.now() + backoff
    }
    throw publishError(dir, lastOutput)
  })
}

module.exports = {publishPackage, applyScope}
