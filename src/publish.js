'use strict'

const fs = require('node:fs')
const path = require('node:path')
const {execFile} = require('node:child_process')
const {promisify} = require('node:util')

const execFileAsync = promisify(execFile)

// Rewrite an already-built package dir to publish under a test scope
// (e.g. "@openfonts-test"). Done as the very last step so everything else
// about the build — including versions computed from the real @openfonts
// registry — stays a faithful rehearsal.
function applyScope(dir, scope) {
  const pkgPath = path.join(dir, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  pkg.name = pkg.name.replace(/^@openfonts\//, `${scope}/`)
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')
  const readmePath = path.join(dir, 'README.md')
  const readme = fs.readFileSync(readmePath, 'utf8')
  fs.writeFileSync(readmePath, readme.replaceAll('@openfonts/', `${scope}/`))
}

// Run `npm publish` (or --dry-run) in a built package dir.
// Returns {published: bool, dryRun: bool, output}.
async function publishPackage(dir, {dryRun = true, scope = null} = {}) {
  if (scope) applyScope(dir, scope)
  const args = ['publish', '--ignore-scripts']
  if (dryRun) args.push('--dry-run')
  try {
    const {stdout, stderr} = await execFileAsync('npm', args, {cwd: dir, timeout: 300000})
    return {published: !dryRun, dryRun, output: (stdout + stderr).trim()}
  } catch (error) {
    const output = `${error.stdout || ''}${error.stderr || ''}`.trim()
    const err = new Error(`npm publish failed in ${dir}: ${output || error.message}`)
    err.isDuplicateVersion = /cannot publish over|previously published versions/i.test(output)
    throw err
  }
}

module.exports = {publishPackage, applyScope}
