# Architecture

## Why the rewrite

The 2019–2020 pipeline died and misbehaved for structural reasons:

- **Change detection compared Google's `lastModified` metadata**, not content. On the
  final Jenkins run (2020-09-22), 177 of 195 published packages had zero binary change.
- **Publishing was driven by lerna's git-diff detection** over a 3.3 GB monorepo with
  binaries committed; unconditional churn (`gstatic/*.link`, `files-last-modified.json`)
  triggered publishes of untouched packages.
- **A template hardcoded `"version": "0.0.0"`** and intermittently clobbered package
  versions; the compensating restore step lived only in the (deleted) Jenkins job config.
  Consequence: local/git versions diverged from npm — many packages' git tree said
  0.0.x while npm `latest` is 1.44.x (the 2020 0.0.x re-publishes failed as duplicates).
- The data source `google-webfonts-helper.herokuapp.com` disappeared with Heroku's free
  tier (Nov 2022).

## Principles

1. **The npm registry is the only source of truth** — for versions (max over all
   published versions ∪ `dist-tags.latest`, guarding against the out-of-order 2020
   history) and for published content (the tarball itself).
2. **Nothing publishes unless shipped content actually differs.**
3. **Git holds no build outputs** — only code, CI, fixtures, and a discardable cache.
4. **Consumer compatibility is absolute**: same package names, same `index.css` entry
   point, same file layout, monotonically increasing versions.

## Change detection — three layers

```
descriptor (gwfh API) ──► fingerprint (sha256 of canonical source identity)
        │
        ├─ layer 1: fingerprint == published package.json openfonts.sourceFingerprint? ──► skip
        ├─ layer 2: state/manifest.json has {fingerprint, latestVersion}?             ──► skip
        └─ layer 3: build + download published tarball + canonical compare
                       ├─ equal   ──► record in manifest, no publish
                       └─ differs ──► patch-bump over registry latest, publish
```

**Fingerprint** (`src/fingerprint.js`): sha256 over `{id, subset, family, version,
variants[{id, fontStyle, fontWeight, woff, woff2}] sorted}`. Excluded on purpose:
`popularity` (daily churn), `lastModified` (metadata-only releases — the 2020 bug),
`eot/svg/ttf` (not shipped), `local` names (dropped by the gwfh API ~2022), `subsets`
order, `storeID`.

**Canonical compare** (`src/compare.js`):

| shipped file | role in the publish decision |
|---|---|
| `files/*.woff{,2}` | byte compare (sha256) |
| `index.css` | compare after stripping `local()` lines and trailing whitespace |
| `package.json` | compare only `name, description, main, keywords, author, license` |
| `README.md`, `LICENSE.md`, `font-descriptor.json`, `files-last-modified.json` | ignored — cosmetic or duplicated by the above |

The `local()` normalization exists because the current gwfh API no longer returns local
font names, so freshly generated CSS can never byte-match the 2019/2020 CSS; without
normalization every package would republish once for a cosmetic reason.

**Manifest** (`state/manifest.json`) is a cache, never truth: an entry means "this
fingerprint was verified byte-equal against this published version". It exists because
verified-unchanged packages would otherwise re-download fonts + tarball every day
forever (their published fingerprint predates the v2 pipeline). Committed back by CI
after publish runs; safe to delete (`--full-verify` rebuilds it); carries no timestamps
so unchanged runs produce no diff.

## Versioning

- changed content → `semver.inc(latest, 'patch')`, where `latest` is resolved from the
  packument at decision time. Duplicate-version collisions (the 2020 failure mode) are
  structurally impossible; on npm `E403 cannot publish over`, the packument is
  re-fetched and the publish retried once with a fresh bump.
- never-published package → `1.0.0`.
- removed from Google Fonts → reported (`removed` outcome), frozen, never unpublished.
  `state/known-packages.json` (the 2,695 historical names) powers this detection.

## Package format contract

Verified against real published tarballs (recorded in `test/fixtures/`): 8 files —
`package.json`, `README.md`, `index.css`, `font-descriptor.json`,
`files-last-modified.json`, `LICENSE.md` (the old lerna injected it from the repo root;
the builder copies it explicitly), `files/*.woff`, `files/*.woff2`.

`src/templates.js` is a byte-exact port of the old lodash templates, quirks included
(README leading blank line, trailing space after the last `src:` continuation line,
`abel-400normal - latin` comment style, string-sorted variants `"100" < "100italic" <
"200"`). Golden tests assert byte identity of `index.css` against the 2020 git tree and
of `README.md` against published tarballs.

Two deliberate format changes, both excluded from the publish decision:

- `package.json` gains `"openfonts": {"sourceFingerprint", "builtAt"}` (enables layer 1)
  and `"publishConfig": {"access": "public"}`, and its `repository` now points at the
  repo root (the old `/tree/master/packages/...` paths break after the restructure).
- new CSS has no `local()` hints (data no longer exists upstream).

## Scale and robustness

- Concurrency: 8 fonts in flight; 4 font-file downloads per package; per-package
  failures are isolated (`failed` outcome + exit code 1, run continues).
- Steady state: ~4.6 k gwfh calls (local container) + ~2.7 k packument GETs, near-zero
  downloads → well under 30 min. Backlog runs are bounded by `--max-publish` (default
  300) — verification still covers everything, only publishes are deferred.
- Failed packages retry naturally next run (no manifest entry is written for them).
- Dry runs never write manifest entries for would-be publishes; verified-unchanged
  entries are always safe to record (they state registry facts, not publish facts).

## The 2026 backlog

Google re-encoded virtually every font since 2020 (verified: even fonts with unchanged
kit hashes serve different bytes under new version paths, e.g. numans v10 vs v16). The
first publish-enabled runs will therefore legitimately republish most of the catalog,
~300/day until drained. New subsets appeared as well (e.g. `open-sans_math`,
`open-sans_symbols`, `open-sans_hebrew` → new 1.0.0 packages). The old catalog also
shrank: gwfh now lists 1,951 fonts vs 2,695 historical packages — the difference shows
up as `removed` in reports and stays frozen on npm.
