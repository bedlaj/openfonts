'use strict'

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const tar = require('tar')

const FIXTURES = path.join(__dirname, 'fixtures')

const FIXTURE_PACKAGES = [
  'abel_latin',
  'open-sans_latin',
  'open-sans_cyrillic',
  'open-sans_all',
  'raleway_latin',
  'amiri_arabic',
]

function fixtureDir(name) {
  return path.join(FIXTURES, name)
}

function descriptor2020(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir(name), 'descriptor-2020.json'), 'utf8'))
}

function descriptorCurrent(name) {
  return JSON.parse(fs.readFileSync(path.join(fixtureDir(name), 'descriptor-current.json'), 'utf8'))
}

function subsetKeyOf(name) {
  return name.slice(name.lastIndexOf('_') + 1)
}

// Extract the recorded published tarball into a temp dir; returns package root.
async function extractPublished(name) {
  const dir = fixtureDir(name)
  const tgz = fs.readdirSync(dir).find(f => f.endsWith('.tgz'))
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'openfonts-test-'))
  await tar.x({file: path.join(dir, tgz), cwd: dest})
  return path.join(dest, 'package')
}

module.exports = {FIXTURES, FIXTURE_PACKAGES, fixtureDir, descriptor2020, descriptorCurrent, subsetKeyOf, extractPublished}
