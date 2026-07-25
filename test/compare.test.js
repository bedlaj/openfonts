'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const {comparePackageDirs, normalizeCss} = require('../src/compare')
const {indexCss, readme, packageJson} = require('../src/templates')
const {descriptor2020, descriptorCurrent, subsetKeyOf, extractPublished, FIXTURE_PACKAGES} = require('./helpers')

// Build a package dir WITHOUT network: font binaries are taken from the
// published tarball itself, so only css/package.json generation is exercised.
function buildFromPublishedBinaries(descriptor, subsetKey, publishedDir) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openfonts-built-'))
  fs.mkdirSync(path.join(dir, 'files'))
  for (const f of fs.readdirSync(path.join(publishedDir, 'files'))) {
    fs.copyFileSync(path.join(publishedDir, 'files', f), path.join(dir, 'files', f))
  }
  fs.writeFileSync(path.join(dir, 'index.css'), indexCss(descriptor, subsetKey))
  fs.writeFileSync(path.join(dir, 'README.md'), readme({typefaceId: descriptor.id, typefaceSubset: subsetKey, typefaceName: descriptor.family}))
  const pkg = packageJson({
    fontId: descriptor.id, subsetKey, family: descriptor.family,
    version: '9.9.9', fingerprint: 'x'.repeat(64), builtAt: '2026-01-01T00:00:00.000Z',
  })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
  return dir
}

// A rebuild from the publish-era descriptor with identical binaries must be
// reported unchanged — this is the property that prevents mass republishing.
for (const name of FIXTURE_PACKAGES) {
  test(`rebuild from 2020 descriptor is unchanged: ${name}`, async () => {
    const publishedDir = await extractPublished(name)
    // The git-tree descriptor can be newer than the published tarball (e.g.
    // abel got v12 in git after 1.44.1 shipped with v10). Reconstruct the
    // publish-era variant set from the published css instead when they differ:
    // identical URLs in css <=> identical file naming <=> comparable.
    const built = buildFromPublishedBinaries(descriptor2020(name), subsetKeyOf(name), publishedDir)
    const {changed, reasons} = comparePackageDirs(built, publishedDir)
    assert.deepEqual(reasons, [])
    assert.equal(changed, false)
  })
}

// Local() lines vanished from the current API. Normalized comparison must
// treat old css (with locals) and new css (without) as equal when the actual
// font references are the same.
test('normalizeCss makes local() lines irrelevant', () => {
  const d2020 = descriptor2020('abel_latin')
  const dNow = JSON.parse(JSON.stringify(descriptorCurrent('abel_latin')))
  // Same font version scenario: URLs differ (v12 vs v18) but css does not
  // embed remote URLs, only local file paths — so css must normalize equal.
  const a = normalizeCss(indexCss(d2020, 'latin'))
  const b = normalizeCss(indexCss(dNow, 'latin'))
  assert.equal(a, b)
})

test('binary change is detected', async () => {
  const publishedDir = await extractPublished('abel_latin')
  const built = buildFromPublishedBinaries(descriptor2020('abel_latin'), 'latin', publishedDir)
  const target = fs.readdirSync(path.join(built, 'files'))[0]
  fs.appendFileSync(path.join(built, 'files', target), 'corrupted')
  const {changed, reasons} = comparePackageDirs(built, publishedDir)
  assert.equal(changed, true)
  assert.match(reasons.join(' '), /content differs/)
})

test('variant set change is detected via css', async () => {
  const publishedDir = await extractPublished('abel_latin')
  const d = JSON.parse(JSON.stringify(descriptor2020('abel_latin')))
  d.variants.push({...d.variants[0], id: '700', fontWeight: '700', fontStyle: 'normal'})
  const built = buildFromPublishedBinaries(d, 'latin', publishedDir)
  const {changed, reasons} = comparePackageDirs(built, publishedDir)
  assert.equal(changed, true)
  assert.match(reasons.join(' '), /index\.css differs/)
})
