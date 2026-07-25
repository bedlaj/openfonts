'use strict'

const {test} = require('node:test')
const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// Stubs `npm` on PATH with a script that fails the first `failures` attempts
// with npm's real E429 output, then succeeds. Returns the attempt counter file.
function withFakeNpm(failures, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfonts-publish-'))
  const bin = path.join(dir, 'bin')
  const pkgDir = path.join(dir, 'pkg')
  fs.mkdirSync(bin)
  fs.mkdirSync(pkgDir)
  fs.writeFileSync(path.join(pkgDir, 'package.json'), '{"name":"@openfonts/x_latin","version":"1.0.0"}\n')
  const counter = path.join(dir, 'attempts')
  fs.writeFileSync(counter, '')
  fs.writeFileSync(path.join(bin, 'npm'), `#!/bin/bash
echo x >> ${counter}
n=$(wc -l < ${counter})
if [ "$n" -le ${failures} ]; then
  echo "npm error code E429" >&2
  echo "npm error 429 Too Many Requests - PUT https://registry.npmjs.org/@openfonts%2fx_latin" >&2
  exit 1
fi
echo "+ @openfonts/x_latin@1.0.0"
`, {mode: 0o755})
  const oldEnv = {
    PATH: process.env.PATH,
    OPENFONTS_PUBLISH_BACKOFF_MS: process.env.OPENFONTS_PUBLISH_BACKOFF_MS,
    NODE_AUTH_TOKEN: process.env.NODE_AUTH_TOKEN,
    NPM_TOKEN: process.env.NPM_TOKEN,
  }
  process.env.PATH = `${bin}:${oldEnv.PATH}`
  process.env.OPENFONTS_PUBLISH_BACKOFF_MS = '10'
  // Without a token the Retry-After probe is skipped, keeping the pure
  // exponential-backoff path deterministic for these tests.
  delete process.env.NODE_AUTH_TOKEN
  delete process.env.NPM_TOKEN
  delete require.cache[require.resolve('../src/publish')]
  const publish = require('../src/publish')
  const done = () => {
    for (const [key, value] of Object.entries(oldEnv)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    delete require.cache[require.resolve('../src/publish')]
    fs.rmSync(dir, {recursive: true, force: true})
  }
  return body({publish, pkgDir, attempts: () => fs.readFileSync(counter, 'utf8').split('\n').filter(Boolean).length}).finally(done)
}

test('publish retries through npm 429 back-pressure', async () => {
  await withFakeNpm(2, async ({publish, pkgDir, attempts}) => {
    const result = await publish.publishPackage(pkgDir, {dryRun: false})
    assert.equal(result.published, true)
    assert.equal(attempts(), 3, 'two 429s should be retried, third attempt succeeds')
  })
})

test('a 429 whose write landed anyway counts as published, not a conflict', async () => {
  // npm commits the version, then fails the response with 429; the retry sees
  // its own upload as "cannot publish over".
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfonts-publish-late-'))
  const bin = path.join(dir, 'bin')
  const pkgDir = path.join(dir, 'pkg')
  fs.mkdirSync(bin)
  fs.mkdirSync(pkgDir)
  fs.writeFileSync(path.join(pkgDir, 'package.json'), '{"name":"@openfonts/x_latin","version":"1.0.0"}\n')
  const counter = path.join(dir, 'attempts')
  fs.writeFileSync(counter, '')
  fs.writeFileSync(path.join(bin, 'npm'), `#!/bin/bash
echo x >> ${counter}
n=$(wc -l < ${counter})
if [ "$n" -eq 1 ]; then echo "npm error code E429" >&2; exit 1; fi
echo "npm error 403 You cannot publish over the previously published versions: 1.0.0." >&2
exit 1
`, {mode: 0o755})
  const oldPath = process.env.PATH
  process.env.PATH = `${bin}:${oldPath}`
  process.env.OPENFONTS_PUBLISH_BACKOFF_MS = '10'
  delete require.cache[require.resolve('../src/publish')]
  const publish = require('../src/publish')
  try {
    const result = await publish.publishPackage(pkgDir, {dryRun: false})
    assert.equal(result.published, true)
    assert.equal(result.landedOnEarlierAttempt, true)
  } finally {
    process.env.PATH = oldPath
    delete process.env.OPENFONTS_PUBLISH_BACKOFF_MS
    delete require.cache[require.resolve('../src/publish')]
    fs.rmSync(dir, {recursive: true, force: true})
  }
})

test('publish gives up after exhausting retries and flags rate limiting', async () => {
  const oldRetries = process.env.OPENFONTS_PUBLISH_RETRIES
  process.env.OPENFONTS_PUBLISH_RETRIES = '2'
  try {
    await withFakeNpm(99, async ({publish, pkgDir, attempts}) => {
      await assert.rejects(
        () => publish.publishPackage(pkgDir, {dryRun: false}),
        error => {
          assert.equal(error.isRateLimited, true)
          assert.equal(error.isDuplicateVersion, false)
          return true
        },
      )
      assert.equal(attempts(), 3, 'initial attempt plus two retries')
    })
  } finally {
    if (oldRetries === undefined) delete process.env.OPENFONTS_PUBLISH_RETRIES
    else process.env.OPENFONTS_PUBLISH_RETRIES = oldRetries
  }
})

test('dry runs bypass the publish queue and do not retry', async () => {
  await withFakeNpm(1, async ({publish, pkgDir, attempts}) => {
    await assert.rejects(() => publish.publishPackage(pkgDir, {dryRun: true}))
    assert.equal(attempts(), 1, 'dry run must not burn retries on back-pressure')
  })
})

// Run body with the probe enabled: token set and globalThis.fetch stubbed to
// answer the raw PUT probe with the given status/headers.
async function withProbe(probeResponse, fakeNpmFailures, body) {
  const realFetch = globalThis.fetch
  const probeCalls = []
  globalThis.fetch = async (url, opts) => {
    probeCalls.push({url: String(url), method: opts?.method})
    return {
      status: probeResponse.status,
      headers: {get: name => (name.toLowerCase() === 'retry-after' ? probeResponse.retryAfter ?? null : null)},
      arrayBuffer: async () => new ArrayBuffer(0),
    }
  }
  try {
    await withFakeNpm(fakeNpmFailures, async ctx => {
      process.env.NODE_AUTH_TOKEN = 'test-token'
      await body({...ctx, probeCalls})
    })
  } finally {
    globalThis.fetch = realFetch
  }
}

test('429 backoff obeys the registry Retry-After from the probe', async () => {
  await withProbe({status: 429, retryAfter: '1'}, 1, async ({publish, pkgDir, attempts, probeCalls}) => {
    const started = Date.now()
    const result = await publish.publishPackage(pkgDir, {dryRun: false})
    assert.equal(result.published, true)
    assert.equal(attempts(), 2)
    assert.equal(probeCalls.length, 1)
    assert.match(probeCalls[0].url, /@openfonts%2Fx_latin$/i)
    assert.equal(probeCalls[0].method, 'PUT')
    assert.ok(Date.now() - started >= 1000, 'must wait at least the Retry-After second')
  })
})

test('a Retry-After beyond the give-up threshold defers immediately', async () => {
  await withProbe({status: 429, retryAfter: '1934'}, 99, async ({publish, pkgDir, attempts}) => {
    await assert.rejects(
      () => publish.publishPackage(pkgDir, {dryRun: false}),
      error => {
        assert.equal(error.isRateLimited, true)
        assert.equal(error.retryAfterMs, 1934000)
        assert.match(error.message, /Retry-After is 1934s/)
        return true
      },
    )
    assert.equal(attempts(), 1, 'no blind retries when the registry says the wait is 32 minutes')
  })
})

test('probe seeing the limiter lifted retries promptly', async () => {
  await withProbe({status: 401}, 1, async ({publish, pkgDir, attempts}) => {
    const result = await publish.publishPackage(pkgDir, {dryRun: false})
    assert.equal(result.published, true)
    assert.equal(attempts(), 2)
  })
})

test('duplicate-version errors are still distinguished from rate limiting', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfonts-publish-dup-'))
  const bin = path.join(dir, 'bin')
  const pkgDir = path.join(dir, 'pkg')
  fs.mkdirSync(bin)
  fs.mkdirSync(pkgDir)
  fs.writeFileSync(path.join(pkgDir, 'package.json'), '{"name":"@openfonts/x_latin","version":"1.0.0"}\n')
  fs.writeFileSync(path.join(bin, 'npm'), '#!/bin/bash\necho "npm error You cannot publish over the previously published versions: 1.0.0." >&2\nexit 1\n', {mode: 0o755})
  const oldPath = process.env.PATH
  process.env.PATH = `${bin}:${oldPath}`
  delete require.cache[require.resolve('../src/publish')]
  const publish = require('../src/publish')
  try {
    await assert.rejects(
      () => publish.publishPackage(pkgDir, {dryRun: false}),
      error => {
        assert.equal(error.isDuplicateVersion, true)
        assert.equal(error.isRateLimited, false)
        return true
      },
    )
  } finally {
    process.env.PATH = oldPath
    delete require.cache[require.resolve('../src/publish')]
    fs.rmSync(dir, {recursive: true, force: true})
  }
})
