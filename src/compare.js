'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

// Only these differences count as "the package changed":
//   - files/** bytes
//   - index.css, modulo local() lines (the gwfh API dropped local names in
//     ~2022, so freshly generated CSS can never contain them; stripping both
//     sides keeps the 2,695 already-published packages from mass-republishing)
//   - the stable package.json fields
// README/LICENSE/font-descriptor/files-last-modified are cosmetic or already
// covered by the above, and registry-injected fields (gitHead, dist, ...)
// never match a local build.
const PACKAGE_JSON_FIELDS = ['name', 'description', 'main', 'keywords', 'author', 'license']

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
}

function normalizeCss(css) {
  return css
    .split('\n')
    .map(line => line.replace(/\s+$/, ''))
    .filter(line => !/^\s*local\(.*\),?$/.test(line))
    .join('\n')
}

function listFiles(dir) {
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : []
}

// Compare a freshly built package dir against an extracted published tarball.
// Returns {changed, reasons}; reasons is empty when unchanged.
function comparePackageDirs(builtDir, publishedDir) {
  const reasons = []

  const builtFiles = listFiles(path.join(builtDir, 'files'))
  const publishedFiles = listFiles(path.join(publishedDir, 'files'))
  if (builtFiles.join(',') !== publishedFiles.join(',')) {
    const added = builtFiles.filter(f => !publishedFiles.includes(f))
    const removed = publishedFiles.filter(f => !builtFiles.includes(f))
    reasons.push(`files/ listing differs (+${added.length} -${removed.length}: ${[...added.map(f => `+${f}`), ...removed.map(f => `-${f}`)].slice(0, 6).join(', ')}${added.length + removed.length > 6 ? ', …' : ''})`)
  } else {
    const differing = builtFiles.filter(
      f => sha256(path.join(builtDir, 'files', f)) !== sha256(path.join(publishedDir, 'files', f))
    )
    if (differing.length > 3) reasons.push(`${differing.length}/${builtFiles.length} font files differ`)
    else for (const f of differing) reasons.push(`files/${f} content differs`)
  }

  const builtCss = fs.readFileSync(path.join(builtDir, 'index.css'), 'utf8')
  const publishedCssPath = path.join(publishedDir, 'index.css')
  const publishedCss = fs.existsSync(publishedCssPath) ? fs.readFileSync(publishedCssPath, 'utf8') : ''
  if (normalizeCss(builtCss) !== normalizeCss(publishedCss)) reasons.push('index.css differs (normalized)')

  const builtPkg = JSON.parse(fs.readFileSync(path.join(builtDir, 'package.json'), 'utf8'))
  const publishedPkg = JSON.parse(fs.readFileSync(path.join(publishedDir, 'package.json'), 'utf8'))
  for (const field of PACKAGE_JSON_FIELDS) {
    if (JSON.stringify(builtPkg[field]) !== JSON.stringify(publishedPkg[field])) {
      reasons.push(`package.json field "${field}" differs`)
    }
  }

  return {changed: reasons.length > 0, reasons}
}

module.exports = {comparePackageDirs, normalizeCss, PACKAGE_JSON_FIELDS}
