# Scripts

Dev and release helpers for **5harness**.

## Product CLI

The user-facing CLI is the npm bin `harness` (source: `npm/shim.mjs`, build
output `dist/cli.js`; product runtime is the Rust binary). Local development:

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

## npm-install-smoke

`npm-install-smoke.mjs` packs the current tree, installs that tarball into a
temporary isolated npm prefix, and runs the installed `harness --version`.
It is used by the CI OS matrix to prove the npm launcher resolves the native
binary on Linux, macOS, and Windows.

```bash
npm run install:smoke
```

## stage-native

`stage-native.mjs` collects target-scoped artifacts downloaded from the native
build matrix and writes `bin/harness-<rust-target>` files for npm packaging and
GitHub Release uploads. It fails when a supported target is missing or
ambiguous.

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

## release-plan / protected release PR (CI)

- `release-plan.mjs` — skip / tag-only / bump decision for auto-release.
- `create-release-pr.mjs` — commit the prepared version files to an
  `automation/release/vX.Y.Z` branch and open (or reuse) a release PR. This is
  the normal path because `main` is protected by a pull-request ruleset.
- `git-push-release.mjs` — legacy commit + tag push with rebase retries, plus
  `--tag-only` for the post-merge path. Tag-only mode verifies that the checked
  out commit is already `origin/main` and never writes protected `main`.

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
