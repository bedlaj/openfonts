'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {fingerprint} = require('../src/fingerprint')
const {descriptorCurrent} = require('./helpers')

test('fingerprint is stable across volatile metadata changes', () => {
  const d = descriptorCurrent('abel_latin')
  const noisy = JSON.parse(JSON.stringify(d))
  noisy.popularity = 99999
  noisy.lastModified = '2030-01-01'
  noisy.subsets = [...noisy.subsets].reverse()
  noisy.variants = noisy.variants.map(v => ({...v, svg: 'x', eot: 'y', ttf: 'z'}))
  assert.equal(fingerprint(d, 'latin'), fingerprint(noisy, 'latin'))
})

test('fingerprint changes when font content can change', () => {
  const d = descriptorCurrent('abel_latin')
  const base = fingerprint(d, 'latin')

  const bumped = JSON.parse(JSON.stringify(d))
  bumped.version = 'v19'
  assert.notEqual(fingerprint(bumped, 'latin'), base)

  const newUrl = JSON.parse(JSON.stringify(d))
  newUrl.variants[0].woff2 = newUrl.variants[0].woff2.replace('v18', 'v19')
  assert.notEqual(fingerprint(newUrl, 'latin'), base)

  assert.notEqual(fingerprint(d, 'latin-ext'), base)
})

test('fingerprint ignores variant order', () => {
  const d = descriptorCurrent('raleway_latin')
  const shuffled = JSON.parse(JSON.stringify(d))
  shuffled.variants.reverse()
  assert.equal(fingerprint(d, 'latin'), fingerprint(shuffled, 'latin'))
})
