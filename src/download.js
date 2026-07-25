'use strict'

const {setTimeout: sleep} = require('node:timers/promises')

const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504])

// GET a URL and return {status, body: Buffer}. Retries network errors and
// retryable HTTP statuses with exponential backoff. A non-retryable status
// (404 included) is returned to the caller, not thrown.
async function fetchRaw(url, {retries = 3, timeoutMs = 120000, headers = {}} = {}) {
  let lastError
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(1000 * 2 ** (attempt - 1))
    try {
      const res = await fetch(url, {headers, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow'})
      if (RETRYABLE_STATUS.has(res.status)) {
        lastError = new Error(`HTTP ${res.status} for ${url}`)
        continue
      }
      const body = Buffer.from(await res.arrayBuffer())
      return {status: res.status, body}
    } catch (error) {
      lastError = error
    }
  }
  throw new Error(`GET ${url} failed after ${retries + 1} attempts: ${lastError}`)
}

// GET a URL that must succeed and return a non-empty Buffer.
async function fetchBuffer(url, options = {}) {
  const {status, body} = await fetchRaw(url, options)
  if (status !== 200) throw new Error(`HTTP ${status} for ${url}`)
  if (body.length === 0) throw new Error(`Empty response body for ${url}`)
  return body
}

async function fetchJson(url, options = {}) {
  const body = await fetchBuffer(url, options)
  return JSON.parse(body.toString('utf8'))
}

module.exports = {fetchRaw, fetchBuffer, fetchJson}
