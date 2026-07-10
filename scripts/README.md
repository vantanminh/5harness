# Scripts

Dev and release helpers for **@vantanminh/harness**.

## Product CLI

The user-facing CLI is the npm bin `harness` (source: `src/cli.ts`, build output
`dist/cli.js`). Local development:

```bash
npm run harness -- --help
# or after build:
node dist/cli.js --help
```

## pack-check

`pack-check.mjs` validates the published tarball shape (bin, templates,
migrations, version sync). Used by `npm run pack:check` and `release:check`.

```bash
npm run pack:check
```

## bump-version

`bump-version.mjs` increments the package version and keeps release-critical
files in sync (`package.json`, `package-lock.json`, `src/version.ts`,
`templates/AGENTS.md` / `AGENTS.md` harness-version markers).

```bash
npm run bump          # patch
npm run bump -- minor
npm run bump -- major
npm run bump -- 1.2.3 # exact
```

CI auto-release and the Release workflow call this script; prefer not to bump
by hand unless you are preparing a local publish.

## Schema / migrations

Operational durable state is **markdown** under each project. SQL under
`migrations/` supports legacy `harness import-sqlite` only — not the default
init path.
