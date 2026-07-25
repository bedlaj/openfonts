'use strict'

const crypto = require('node:crypto')

// A stable identity for "what this package would be built from". Volatile
// descriptor fields are excluded on purpose:
//   - popularity churns daily and never affects shipped content
//   - lastModified changes on metadata-only releases (the 2020 pipeline's
//     false-positive bug); the font version + gstatic URLs already change
//     whenever content can change
//   - eot/svg/ttf URLs are not shipped
//   - local() names were dropped by the gwfh API and are gone from new CSS
function canonicalSource(descriptor, subsetKey) {
  return {
    id: descriptor.id,
    subset: subsetKey,
    family: descriptor.family,
    version: descriptor.version,
    variants: descriptor.variants
      .map(v => ({
        id: v.id,
        fontStyle: v.fontStyle,
        fontWeight: v.fontWeight,
        woff: v.woff,
        woff2: v.woff2,
      }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  }
}

function fingerprint(descriptor, subsetKey) {
  const json = JSON.stringify(canonicalSource(descriptor, subsetKey))
  return crypto.createHash('sha256').update(json).digest('hex')
}

module.exports = {fingerprint, canonicalSource}
