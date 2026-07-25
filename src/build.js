'use strict'

const fs = require('node:fs')
const path = require('node:path')

const {indexCss, readme, packageJson, fontFilePath, sortVariants} = require('./templates')
const {fetchBuffer} = require('./download')
const {mapLimit} = require('./util/pool')

// Build one complete publishable package directory. Downloads every woff/woff2
// for the subset; any failed download fails the whole package (the old
// pipeline silently shipped CSS without the @font-face rule instead).
async function buildPackage({descriptor, subsetKey, version, fingerprint, builtAt, dir, licenseText, downloadConcurrency = 4}) {
  fs.rmSync(dir, {recursive: true, force: true})
  fs.mkdirSync(path.join(dir, 'files'), {recursive: true})

  const jobs = []
  for (const variant of sortVariants(descriptor.variants)) {
    for (const extension of ['woff', 'woff2']) {
      const url = variant[extension]
      if (!url) throw new Error(`variant ${variant.id} of ${descriptor.id} has no ${extension} URL`)
      jobs.push({url, rel: fontFilePath(descriptor.id, subsetKey, variant, extension, 'files')})
    }
  }
  const results = await mapLimit(jobs, downloadConcurrency, async job => {
    const body = await fetchBuffer(job.url, {retries: 3})
    fs.writeFileSync(path.join(dir, job.rel), body)
  })
  const failed = results.map((r, i) => (r.ok ? null : `${jobs[i].url}: ${r.error.message}`)).filter(Boolean)
  if (failed.length > 0) throw new Error(`font downloads failed:\n${failed.join('\n')}`)

  fs.writeFileSync(path.join(dir, 'index.css'), indexCss(descriptor, subsetKey))
  fs.writeFileSync(
    path.join(dir, 'README.md'),
    readme({typefaceId: descriptor.id, typefaceSubset: subsetKey, typefaceName: descriptor.family})
  )
  fs.writeFileSync(path.join(dir, 'font-descriptor.json'), JSON.stringify(descriptor, null, 2))
  fs.writeFileSync(
    path.join(dir, 'files-last-modified.json'),
    JSON.stringify({lastModified: descriptor.lastModified, version: descriptor.version})
  )
  fs.writeFileSync(path.join(dir, 'LICENSE.md'), licenseText)
  const pkg = packageJson({
    fontId: descriptor.id,
    subsetKey,
    family: descriptor.family,
    version,
    fingerprint,
    builtAt,
  })
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2) + '\n')
  return dir
}

module.exports = {buildPackage}
