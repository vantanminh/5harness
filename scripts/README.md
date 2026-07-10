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

## Schema / migrations

Operational durable state is **markdown** under each project. SQL under
`migrations/` supports legacy `harness import-sqlite` only — not the default
init path.
