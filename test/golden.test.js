'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {indexCss, readme} = require('../src/templates')
const {FIXTURE_PACKAGES, fixtureDir, descriptor2020, subsetKeyOf, extractPublished} = require('./helpers')

// The 2020 descriptors came from the old repo's committed font-descriptor.json
// (the exact API responses the old pipeline built from). Rendering them must
// reproduce the git-tree index.css byte for byte — proving the template port.
for (const name of FIXTURE_PACKAGES) {
  test(`index.css golden (git tree 2020): ${name}`, () => {
    const expected = fs.readFileSync(path.join(fixtureDir(name), 'index-2020.css'), 'utf8')
    const actual = indexCss(descriptor2020(name), subsetKeyOf(name))
    assert.equal(actual, expected)
  })
}

// The published tarballs are older than the last git tree (published at
// 1.44.x in 2020); their css/README came from the same templates, so README
// must match byte-for-byte and css must match whenever the variant metadata
// in files-last-modified/font-descriptor matched at publish time. README is
// deterministic — assert it for all fixtures.
for (const name of FIXTURE_PACKAGES) {
  test(`README golden (published tarball): ${name}`, async () => {
    const publishedDir = await extractPublished(name)
    const expected = fs.readFileSync(path.join(publishedDir, 'README.md'), 'utf8')
    const d = descriptor2020(name)
    const actual = readme({typefaceId: d.id, typefaceSubset: subsetKeyOf(name), typefaceName: d.family})
    assert.equal(actual, expected)
  })
}
