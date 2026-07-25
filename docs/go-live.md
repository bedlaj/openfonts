# Go-live checklist

Nothing publishes to `@openfonts` until every step here is done deliberately. The
pipeline has a double gate: CI dry-runs everything until the `PUBLISH_ENABLED`
repository **variable** is `true`, and locally nothing publishes without `--publish`.

## 1. Secrets and tokens (npmjs.com + GitHub)

- [ ] Create a **granular automation token** on npmjs.com scoped to the `@openfonts`
      org (packages & scopes: read/write; allowed to bypass 2FA for automation).
- [ ] Add it as the `NPM_TOKEN` Actions secret on `bedlaj/openfonts`.
- [ ] Create a free **Google Fonts Developer API key**
      (https://developers.google.com/fonts/docs/developer_api) and add it as the
      `GOOGLE_FONTS_API_KEY` Actions secret — the google-webfonts-helper service
      container needs it to load the font catalog.

## 2. Test-scope rehearsal (recommended)

- [ ] Create a throwaway npm scope/org, e.g. `@openfonts-test`, and a token for it.
- [ ] Locally: `npm login` with that account, then
      `node src/cli.js sync --only abel,open-sans --scope @openfonts-test --publish`
- [ ] Install one published package in a scratch vite/webpack project and check the
      font loads (`require('@openfonts-test/abel_latin')`).
      Versions are still computed from the real `@openfonts` registry, so the rehearsal
      is faithful.

## 3. Repository restructure

- [ ] Create `bedlaj/openfonts-archive` on GitHub and push the old `master` there in
      full (`git push <archive-remote> master` from the old 3.3 GB clone). Verify it
      browses fine.
- [ ] Push the new `main` branch (this tree) to `bedlaj/openfonts`.
- [ ] Switch the default branch of `bedlaj/openfonts` to `main`.
- [ ] Delete `master` from `bedlaj/openfonts` (only after the archive is verified) —
      this is what makes fresh clones small.

## 4. CI dry-run soak

- [ ] Trigger the `sync` workflow manually (`workflow_dispatch`, defaults = dry run).
- [ ] Review the step summary: `published` list should look like plausible real drift;
      `failed` should be ~0; `removed` lists fonts Google dropped since 2020.
- [ ] Let the daily cron dry-run for a few days. Day-to-day the counts should be
      stable (no oscillating publish candidates).

## 5. Flip the switch

- [ ] Set the Actions repository **variable** `PUBLISH_ENABLED` to `true`.
- [ ] The next scheduled run publishes for real, capped at `--max-publish 1000` per day
      until the 2020→2026 backlog drains (expect most of the catalog — Google
      re-encoded nearly everything; see docs/architecture.md).
- [ ] After the first real run, check that CI committed `state/manifest.json` back and
      spot-check a few packages on npmjs.com (`latest` bumped by one patch, tarball
      contains the 8 expected files).

## 6. Aftercare (optional)

- [ ] Deprecate packages listed as `removed` (fonts Google dropped) with e.g.
      `npm deprecate @openfonts/<name> "Font removed from Google Fonts; frozen at last version."`
      — the report artifact gives the list. Never unpublish.
- [ ] Merge/close the ancient dependabot branches on the old repo; they target deleted
      code and are irrelevant after the restructure.
- [ ] Consider a README note on the archive repo pointing here.

## Rollback / safety properties

- Setting `PUBLISH_ENABLED` back to (anything but `true`) stops all publishing at the
  next run; dry-run soak continues.
- `state/manifest.json` can be deleted at any time; the next run re-verifies against
  the registry (`--full-verify` does the same without deleting).
- The pipeline never unpublishes, never deprecates automatically, and can never publish
  a duplicate version (versions are derived from the live packument seconds before
  `npm publish`).
