'use strict'

const fs = require('node:fs')
const path = require('node:path')
const semver = require('semver')

const gwfh = require('./gwfh')
const {fingerprint} = require('./fingerprint')
const registry = require('./registry')
const {buildPackage} = require('./build')
const {comparePackageDirs} = require('./compare')
const manifestStore = require('./manifest')
const {publishPackage} = require('./publish')
const reportStore = require('./report')
const {mapLimit} = require('./util/pool')

const ROOT = path.join(__dirname, '..')

const DEFAULTS = {
  api: 'https://gwfh.mranftl.com/api/fonts',
  publish: false,
  fullVerify: false,
  only: null,
  scope: null,
  maxPublish: 300,
  workdir: path.join(ROOT, '.work'),
  manifest: path.join(ROOT, 'state', 'manifest.json'),
  known: path.join(ROOT, 'state', 'known-packages.json'),
  report: path.join(ROOT, 'report.json'),
  summary: process.env.GITHUB_STEP_SUMMARY || null,
  fontConcurrency: 8,
  downloadConcurrency: 4,
  keepWork: false,
}

function parseArgs(argv) {
  const opts = {...DEFAULTS}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`missing value for ${arg}`)
      return argv[++i]
    }
    const bool = raw => raw === undefined || raw === '' || raw === 'true'
    const [flag, inlineValue] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, undefined]
    switch (flag) {
      case '--api': opts.api = inlineValue ?? next(); break
      case '--publish': opts.publish = bool(inlineValue); break
      case '--full-verify': opts.fullVerify = bool(inlineValue); break
      case '--only': { const v = inlineValue ?? next(); opts.only = v ? v.split(',').filter(Boolean) : null; break }
      case '--scope': { const v = inlineValue ?? next(); opts.scope = v || null; break }
      case '--max-publish': opts.maxPublish = Number(inlineValue ?? next()); break
      case '--workdir': opts.workdir = path.resolve(inlineValue ?? next()); break
      case '--manifest': opts.manifest = path.resolve(inlineValue ?? next()); break
      case '--report': opts.report = path.resolve(inlineValue ?? next()); break
      case '--summary': opts.summary = inlineValue ?? next(); break
      case '--font-concurrency': opts.fontConcurrency = Number(inlineValue ?? next()); break
      case '--download-concurrency': opts.downloadConcurrency = Number(inlineValue ?? next()); break
      case '--keep-work': opts.keepWork = bool(inlineValue); break
      default: throw new Error(`unknown flag: ${arg}`)
    }
  }
  return opts
}

// npm back-pressure is not a pipeline failure: the package is simply deferred to
// the next run. If it keeps happening the account is being throttled hard, so
// stop attempting publishes altogether rather than burn the job timeout on
// backoff sleeps — everything left over is reported as deferred.
function noteRateLimitGiveUp(ctx) {
  const {state, opts} = ctx
  state.rateLimitGiveUps++
  if (state.rateLimitGiveUps >= 5 && !state.rateLimitHalted) {
    state.rateLimitHalted = true
    state.publishCount = opts.maxPublish
    console.log('npm rate limiting persists after retries; halting further publish attempts this run')
  }
}

async function processPackage(ctx, descriptor, subsetKey) {
  const {opts, manifest, report, state} = ctx
  const shortName = gwfh.packageName(descriptor.id, subsetKey)
  const fullName = `@openfonts/${shortName}`
  const fp = fingerprint(descriptor, subsetKey)
  state.seen.add(shortName)

  const packument = await registry.fetchPackument(fullName)
  const workdir = path.join(opts.workdir, shortName)
  const cleanup = () => { if (!opts.keepWork) fs.rmSync(workdir, {recursive: true, force: true}) }

  try {
    if (packument) {
      const latest = registry.resolveLatest(packument)
      if (!latest) throw new Error(`packument for ${fullName} has no valid versions`)

      if (!opts.fullVerify && registry.publishedFingerprint(packument, latest) === fp) {
        manifestStore.record(manifest, shortName, fp, latest)
        reportStore.add(report, shortName, 'skipped-fingerprint')
        return
      }
      if (!opts.fullVerify && manifestStore.matches(manifest, shortName, fp, latest)) {
        reportStore.add(report, shortName, 'skipped-manifest')
        return
      }

      const nextVersion = semver.inc(latest, 'patch')
      const builtDir = path.join(workdir, 'built')
      await buildPackage({
        descriptor, subsetKey, version: nextVersion, fingerprint: fp, builtAt: state.builtAt,
        dir: builtDir, licenseText: state.licenseText, downloadConcurrency: opts.downloadConcurrency,
      })
      const publishedDir = await registry.fetchAndExtractTarball(packument, latest, path.join(workdir, 'published'))
      const {changed, reasons} = comparePackageDirs(builtDir, publishedDir)

      if (!changed) {
        manifestStore.record(manifest, shortName, fp, latest)
        reportStore.add(report, shortName, 'verified-unchanged')
        return
      }
      if (state.publishCount >= opts.maxPublish) {
        reportStore.add(report, shortName, 'publish-deferred', `${latest} -> ${nextVersion}: ${reasons.join('; ')}`)
        return
      }
      state.publishCount++
      let actualVersion = nextVersion
      try {
        try {
          await publishPackage(builtDir, {dryRun: !opts.publish, scope: opts.scope})
        } catch (error) {
          if (!error.isDuplicateVersion) throw error
          const fresh = await registry.fetchPackument(fullName)
          actualVersion = semver.inc(registry.resolveLatest(fresh), 'patch')
          const pkgPath = path.join(builtDir, 'package.json')
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
          pkg.version = actualVersion
          fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
          await publishPackage(builtDir, {dryRun: !opts.publish})
        }
      } catch (error) {
        if (!error.isRateLimited) throw error
        noteRateLimitGiveUp(ctx)
        reportStore.add(report, shortName, 'publish-deferred', `${latest} -> ${nextVersion}: npm rate limited, deferred`)
        return
      }
      if (opts.publish && !opts.scope) manifestStore.record(manifest, shortName, fp, actualVersion)
      reportStore.add(report, shortName, 'published', `${latest} -> ${actualVersion}${opts.publish ? '' : ' (dry run)'}: ${reasons.join('; ')}`)
    } else {
      // Never published before: new font or new subset.
      if (state.publishCount >= opts.maxPublish) {
        reportStore.add(report, shortName, 'publish-deferred', 'new package 1.0.0')
        return
      }
      // Claim the publish slot before the awaits so concurrent tasks cannot
      // overshoot the --max-publish cap.
      state.publishCount++
      const builtDir = path.join(workdir, 'built')
      await buildPackage({
        descriptor, subsetKey, version: '1.0.0', fingerprint: fp, builtAt: state.builtAt,
        dir: builtDir, licenseText: state.licenseText, downloadConcurrency: opts.downloadConcurrency,
      })
      try {
        await publishPackage(builtDir, {dryRun: !opts.publish, scope: opts.scope})
      } catch (error) {
        if (error.isDuplicateVersion) {
          // The packument said 404 but the version exists — a stale registry
          // read, or an earlier attempt that landed. Re-read rather than guess:
          // only claim it if what is published is what we just built, otherwise
          // leave it for the next run's normal update path to version properly.
          const fresh = await registry.fetchPackument(fullName)
          const existing = fresh && registry.resolveLatest(fresh)
          if (existing && registry.publishedFingerprint(fresh, existing) === fp) {
            if (opts.publish && !opts.scope) manifestStore.record(manifest, shortName, fp, existing)
            reportStore.add(report, shortName, 'new', `${existing} (already on the registry)`)
          } else {
            reportStore.add(report, shortName, 'publish-deferred', 'new package already exists with other content; updating next run')
          }
          return
        }
        if (!error.isRateLimited) throw error
        noteRateLimitGiveUp(ctx)
        reportStore.add(report, shortName, 'publish-deferred', 'new package 1.0.0: npm rate limited, deferred')
        return
      }
      if (opts.publish && !opts.scope) manifestStore.record(manifest, shortName, fp, '1.0.0')
      reportStore.add(report, shortName, 'new', `1.0.0${opts.publish ? '' : ' (dry run)'}`)
    }
  } finally {
    cleanup()
  }
}

async function processFont(ctx, fontId) {
  const {opts, report} = ctx
  let def
  try {
    def = await gwfh.fetchDescriptor(opts.api, fontId)
  } catch (error) {
    reportStore.add(report, fontId, 'failed', `descriptor fetch: ${error.message}`)
    return
  }
  for (const {subsetKey, subsets} of gwfh.planSubsets(def)) {
    const shortName = gwfh.packageName(def.id, subsetKey)
    try {
      const descriptor = subsets ? await gwfh.fetchDescriptor(opts.api, fontId, subsets) : def
      await processPackage(ctx, descriptor, subsetKey)
    } catch (error) {
      reportStore.add(report, shortName, 'failed', error.message)
    }
  }
}

async function sync(opts) {
  const manifest = manifestStore.load(opts.manifest)
  const report = reportStore.createReport()
  const state = {
    seen: new Set(),
    publishCount: 0,
    rateLimitGiveUps: 0,
    rateLimitHalted: false,
    builtAt: new Date().toISOString(),
    licenseText: fs.readFileSync(path.join(ROOT, 'LICENSE.md'), 'utf8'),
  }
  const ctx = {opts, manifest, report, state}

  console.log(`sync: api=${opts.api} publish=${opts.publish} scope=${opts.scope || '-'} fullVerify=${opts.fullVerify}`)
  const catalog = await gwfh.fetchCatalog(opts.api)
  let fontIds = catalog.map(f => f.id)
  if (opts.only) fontIds = fontIds.filter(id => opts.only.includes(id))
  console.log(`catalog: ${catalog.length} fonts, processing ${fontIds.length}`)

  let processed = 0
  await mapLimit(fontIds, opts.fontConcurrency, async id => {
    await processFont(ctx, id)
    processed++
    if (processed % 100 === 0) {
      console.log(`progress: ${processed}/${fontIds.length} fonts`)
      manifestStore.save(opts.manifest, manifest)
    }
  })

  // Packages that existed historically but were not produced by this run.
  if (!opts.only) {
    const known = JSON.parse(fs.readFileSync(opts.known, 'utf8'))
    for (const name of known) {
      if (!state.seen.has(name)) reportStore.add(report, name, 'removed', 'no longer produced by the Google Fonts catalog')
    }
  }

  manifestStore.save(opts.manifest, manifest)
  reportStore.finish(report, opts.report)
  const md = reportStore.markdownSummary(report, {dryRun: !opts.publish})
  if (opts.summary) fs.appendFileSync(opts.summary, md + '\n')
  console.log(md)

  const failed = report.counts.failed || 0
  return failed === 0 ? 0 : 1
}

async function main() {
  const [command, ...rest] = process.argv.slice(2)
  if (command !== 'sync') {
    console.error('usage: node src/cli.js sync [--api URL] [--publish] [--full-verify] [--only id1,id2] [--scope @scope] [--max-publish N] [--workdir DIR] [--keep-work]')
    process.exit(2)
  }
  const opts = parseArgs(rest)
  fs.mkdirSync(opts.workdir, {recursive: true})
  process.exitCode = await sync(opts)
}

if (require.main === module) {
  main().catch(error => {
    console.error(error)
    process.exit(1)
  })
}

module.exports = {parseArgs, sync}
