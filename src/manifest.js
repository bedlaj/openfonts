'use strict'

const fs = require('node:fs')

// state/manifest.json is a CACHE, not a source of truth. An entry
// {fingerprint, version} means: "this source fingerprint was verified against
// the published tarball of this version and found unchanged (or was published
// as this version)". Deleting the file only costs one full re-verification.
// Entries deliberately carry no timestamps so the committed file stays diff-
// stable between runs where nothing changed.

function load(file) {
  if (!fs.existsSync(file)) return {schemaVersion: 1, packages: {}}
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function save(file, manifest) {
  const sorted = {}
  for (const key of Object.keys(manifest.packages).sort()) sorted[key] = manifest.packages[key]
  fs.writeFileSync(file, JSON.stringify({schemaVersion: 1, packages: sorted}, null, 2) + '\n')
}

function matches(manifest, name, fingerprint, version) {
  const entry = manifest.packages[name]
  return Boolean(entry && entry.fingerprint === fingerprint && entry.version === version)
}

function record(manifest, name, fingerprint, version) {
  manifest.packages[name] = {fingerprint, version}
}

module.exports = {load, save, matches, record}
