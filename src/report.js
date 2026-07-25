'use strict'

const fs = require('node:fs')

// Outcomes: skipped-fingerprint | skipped-manifest | verified-unchanged |
// published | publish-deferred | new | failed | removed
function createReport() {
  return {startedAt: new Date().toISOString(), outcomes: []}
}

function add(report, name, outcome, detail) {
  report.outcomes.push(detail ? {name, outcome, detail} : {name, outcome})
}

function counts(report) {
  const c = {}
  for (const o of report.outcomes) c[o.outcome] = (c[o.outcome] || 0) + 1
  return c
}

function finish(report, file) {
  report.finishedAt = new Date().toISOString()
  report.counts = counts(report)
  if (file) fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n')
  return report
}

function markdownSummary(report, {dryRun}) {
  const c = counts(report)
  const rows = Object.keys(c)
    .sort()
    .map(k => `| ${k} | ${c[k]} |`)
    .join('\n')
  const list = outcome =>
    report.outcomes
      .filter(o => o.outcome === outcome)
      .map(o => `- \`${o.name}\`${o.detail ? ` — ${o.detail}` : ''}`)
      .join('\n')
  let md = `## openfonts sync ${dryRun ? '(dry run)' : ''}\n\n| outcome | count |\n|---|---|\n${rows}\n`
  for (const outcome of ['published', 'new', 'publish-deferred', 'failed', 'removed']) {
    const section = list(outcome)
    if (section) md += `\n<details><summary>${outcome} (${c[outcome]})</summary>\n\n${section}\n\n</details>\n`
  }
  return md
}

module.exports = {createReport, add, counts, finish, markdownSummary}
