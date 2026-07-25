'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const {resolveLatest, publishedFingerprint} = require('../src/registry')

test('resolveLatest survives the 2020 out-of-order version history', () => {
  // abel_latin's real history: 0.0.1 .. 0.0.11 published in 2019, then
  // 1.44.1; some packages have dist-tags.latest pointing below max.
  const packument = {
    'dist-tags': {latest: '1.44.1'},
    versions: Object.fromEntries(
      ['0.0.1', '0.0.2', '0.0.10', '0.0.11', '0.1.0', '1.0.0', '1.44.0', '1.44.1'].map(v => [v, {}])
    ),
  }
  assert.equal(resolveLatest(packument), '1.44.1')

  const regressedTag = {...packument, 'dist-tags': {latest: '0.0.11'}}
  assert.equal(resolveLatest(regressedTag), '1.44.1')
})

test('publishedFingerprint reads the openfonts field, tolerating absence', () => {
  const packument = {
    versions: {
      '1.44.1': {},
      '1.44.2': {openfonts: {sourceFingerprint: 'abc'}},
    },
  }
  assert.equal(publishedFingerprint(packument, '1.44.1'), null)
  assert.equal(publishedFingerprint(packument, '1.44.2'), 'abc')
  assert.equal(publishedFingerprint({versions: {}}, '9.9.9'), null)
})
