'use strict'

const {fetchJson} = require('./download')

// Client for the google-webfonts-helper API (https://github.com/majodev/google-webfonts-helper).
// `base` is e.g. "http://localhost:9000/api/fonts" or "https://gwfh.mranftl.com/api/fonts".

async function fetchCatalog(base) {
  return fetchJson(base)
}

async function fetchDescriptor(base, id, subsets) {
  const query = subsets ? `?subsets=${subsets.join(',')}` : ''
  return fetchJson(`${base}/${id}${query}`)
}

// Replicate the old pipeline's per-font package/API-call plan exactly.
// Returns [{subsetKey, subsets}] where `subsets` is the ?subsets= list
// (null means the plain default-subset call).
function planSubsets(defDescriptor) {
  const def = defDescriptor.defSubset
  const others = defDescriptor.subsets.filter(s => s !== def)
  const plan = [{subsetKey: def, subsets: null}]
  for (const s of others) plan.push({subsetKey: s, subsets: [def, s]})
  if (others.length > 1) plan.push({subsetKey: 'all', subsets: [def, ...others]})
  return plan
}

function packageName(fontId, subsetKey) {
  return `${fontId}_${subsetKey}`
}

module.exports = {fetchCatalog, fetchDescriptor, planSubsets, packageName}
