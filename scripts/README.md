# Scripts

Dev and release helpers for **5harness**.

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

Also **promotes** non-empty `CHANGELOG.md` `[Unreleased]` into
`## [X.Y.Z] - YYYY-MM-DD` (Keep a Changelog cut, US-038). No-op when
Unreleased is empty or the version section already exists.

```bash
npm run bump          # patch
npm run bump -- minor
npm run bump -- major
npm run bump -- 1.2.3 # exact
```

CI auto-release and the Release workflow call this script; prefer not to bump
by hand unless you are preparing a local publish.

## safe-push (developers)

`safe-push.mjs` — `git fetch` + `pull --rebase` + `push`. Use when main may
have advanced in CI (for example, an auto-release). Before rebasing it snapshots
local commit patch ids; after
the rebase it refreshes matching commit hashes in `.5harness/worklog.jsonl`.
Unmatched entries remain unchanged and produce a warning. A snapshot under
`.git/` survives conflict resolution so rerunning `npm run push` can finish the
reconciliation:

```bash
npm run push
```

## release-plan / git-push-release (CI)

- `release-plan.mjs` — skip / tag-only / bump decision for auto-release.
- `git-push-release.mjs` — commit + tag + push with rebase retries (avoids
  non-fast-forward races on `main`).

## release-notes

`release-notes.mjs` builds GitHub Release body markdown from `CHANGELOG.md`
(version section, else `[Unreleased]`, else a short fallback) plus install and
supply-chain links. Used by CI after npm publish (US-036).

Optional `--with-export` (US-038) appends durable-history assist from
`export-changelog` (implemented stories/decisions). Human CHANGELOG remains
primary.

```bash
node scripts/release-notes.mjs              # current package.json version
node scripts/release-notes.mjs 1.2.3 -o notes.md
node scripts/release-notes.mjs 1.2.3 --with-export -o notes.md
node scripts/release-notes.mjs 1.2.3 --with-export --since 2026-07-01 -o notes.md
```

## Schema / migrations

Operational durable state is **markdown** under each project. SQL under
`migrations/` supports legacy `harness import-sqlite` only — not the default
init path.
