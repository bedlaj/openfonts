'use strict'

const path = require('node:path')
const fs = require('node:fs')
const semver = require('semver')
const tar = require('tar')

const {fetchRaw, fetchBuffer} = require('./download')

const REGISTRY = 'https://registry.npmjs.org'

// Full packument, or null when the package was never published (404).
async function fetchPackument(name, {registry = REGISTRY} = {}) {
  const url = `${registry}/${name.replace('/', '%2f')}`
  const {status, body} = await fetchRaw(url, {retries: 4})
  if (status === 404) return null
  if (status !== 200) throw new Error(`HTTP ${status} for ${url}`)
  return JSON.parse(body.toString('utf8'))
}

// Highest version ever published. dist-tags.latest alone is not trustworthy
// here: the 2020 pipeline pushed 0.0.x versions after 1.44.x existed, so some
// packuments have out-of-order histories.
function resolveLatest(packument) {
  const candidates = Object.keys(packument.versions || {}).filter(v => semver.valid(v))
  const latestTag = packument['dist-tags'] && packument['dist-tags'].latest
  if (latestTag && semver.valid(latestTag)) candidates.push(latestTag)
  if (candidates.length === 0) return null
  return candidates.sort(semver.rcompare)[0]
}

function publishedFingerprint(packument, version) {
  const meta = packument.versions && packument.versions[version]
  return (meta && meta.openfonts && meta.openfonts.sourceFingerprint) || null
}

// Download the tarball of `version` and extract it into destDir. Returns the
// extracted package root (the tarball wraps everything in "package/").
async function fetchAndExtractTarball(packument, version, destDir) {
  const meta = packument.versions[version]
  if (!meta || !meta.dist || !meta.dist.tarball) throw new Error(`No tarball for ${packument.name}@${version}`)
  const buffer = await fetchBuffer(meta.dist.tarball, {retries: 4})
  fs.mkdirSync(destDir, {recursive: true})
  const tgz = path.join(destDir, 'package.tgz')
  fs.writeFileSync(tgz, buffer)
  await tar.x({file: tgz, cwd: destDir})
  fs.unlinkSync(tgz)
  return path.join(destDir, 'package')
}

module.exports = {fetchPackument, resolveLatest, publishedFingerprint, fetchAndExtractTarball, REGISTRY}
