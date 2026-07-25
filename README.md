# openfonts

Self-hosted [Google Fonts](https://fonts.google.com) as npm packages: one package per
font × subset, published under the [`@openfonts`](https://www.npmjs.com/org/openfonts) scope.

```bash
npm install --save @openfonts/open-sans_latin
```

```js
require('@openfonts/open-sans_latin')          // webpack/vite: injects @font-face CSS
```

```scss
@import "~@openfonts/open-sans_latin/index.css";
```

Each package ships `index.css` (`@font-face` rules), the woff/woff2 files, and metadata
(`font-descriptor.json`, `files-last-modified.json`).

Originally a fork of [typefaces](https://github.com/KyleAMathews/typefaces) extended with
per-subset packages. If you want per-weight granularity and variable fonts, also consider
[Fontsource](https://fontsource.org/).

## How updates work (v2 pipeline, 2026 rewrite)

The 2019–2020 pipeline (lerna monorepo with all font binaries committed, Jenkins jobs,
`lastModified`-based change detection) is retired; that tree is preserved on the
[`openfonts-archive`](https://github.com/bedlaj/openfonts-archive) repository. This
repository now contains only the update pipeline; font binaries live exclusively on npm.

A daily GitHub Actions run (`.github/workflows/sync.yml`):

1. starts a [google-webfonts-helper](https://github.com/majodev/google-webfonts-helper)
   service container and reads the full font catalog from it;
2. computes a **source fingerprint** per package (font version + gstatic URLs + variant
   set — volatile metadata like `popularity` is excluded);
3. skips a package when the fingerprint matches the one embedded in the currently
   published version (`package.json` → `openfonts.sourceFingerprint`), or when the
   committed cache `state/manifest.json` says this fingerprint was already verified;
4. otherwise downloads the fonts, builds the package, downloads the currently published
   tarball, and compares **actual content**: font bytes, normalized `index.css`, and the
   stable `package.json` fields. Metadata-only churn does not publish;
5. genuinely changed packages get a patch bump over the highest version on the registry
   (the registry is the only version source of truth) and are published. Never-published
   names (new fonts/subsets) start at 1.0.0. Fonts removed from Google Fonts are only
   reported — nothing is ever unpublished.

Every run writes a step summary and a `report.json` artifact with per-package outcomes.

## Running locally

```bash
npm ci
npm test                          # offline golden tests against recorded fixtures

# dry-run one font against the public gwfh instance (fine for small runs):
node src/cli.js sync --only abel

# full dry-run — self-host gwfh first, be polite to the public instance:
docker run -e GOOGLE_FONTS_API_KEY=... -p 8080:8080 ghcr.io/majodev/google-webfonts-helper:latest
node src/cli.js sync --api http://localhost:8080/api/fonts
```

Nothing publishes without `--publish`, and CI additionally requires the `PUBLISH_ENABLED`
repository variable — see `docs/go-live.md`. Use `--scope @openfonts-test` to rehearse
publishing under a throwaway scope.

## Repository layout

| path | purpose |
|---|---|
| `src/cli.js` | orchestrator (`sync` command) |
| `src/gwfh.js` | google-webfonts-helper API client + per-font subset plan |
| `src/fingerprint.js` | source fingerprint (change-detection layer 1) |
| `src/registry.js` | npm packument/tarball access, version resolution |
| `src/build.js`, `src/templates.js` | package builder — byte-compatible with the old format |
| `src/compare.js` | built-vs-published canonical comparison (layer 3) |
| `src/manifest.js` | `state/manifest.json` cache (layer 2) |
| `src/publish.js` | `npm publish` wrapper, test-scope rewrite |
| `state/known-packages.json` | frozen list of the 2,695 historically published packages |
| `test/` | golden tests against recorded 2020 descriptors + real published tarballs |

See `docs/architecture.md` for design details and `docs/go-live.md` for the operational
checklist.

## License

[MIT](LICENSE.md). The fonts themselves are licensed by their respective authors
(see [Google Fonts](https://fonts.google.com/attribution)).
