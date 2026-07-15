# Distribution

## Package

| Field | Value |
| --- | --- |
| npm name | `5harness` |
| bin | `harness` → `dist/cli.js` |
| GitHub | [vantanminh/5harness](https://github.com/vantanminh/5harness) |
| **Preferred install** | `npm i -g 5harness` |
| Alternate install | `npm i -D 5harness` + `npx harness …` |
| Node | `>=22.5.0` |
| License | MIT |
| Former name | `@vantanminh/harness` — see [DEPRECATION.md](../DEPRECATION.md) |

## Install story (product)

```bash
npm i -g 5harness
cd /path/to/project
harness init          # new project: scaffold + register
# or after git clone of an already-harnessed repo:
harness link          # register path + reindex committed history
```

Global install matches multi-project use and a future local dashboard. Project
files (markdown) remain in the repo for GitHub backup and collaborator clones.

## Published artifacts

The npm tarball **must** include:

- `dist/**` (compiled CLI, shebang on `dist/cli.js`)
- `templates/**` (init payload + `manifest.json`)
- schema/templates needed for entity writes (as implemented)
- `package.json`, `README.md`, `LICENSE`

> Note: `migrations/**` remain only for legacy `harness import-sqlite`.
> Operational SoT is markdown under `docs/`.

## Release checklist

### Default (automatic)

1. Merge / push to `main` (do **not** hand-bump the version).
2. CI runs `release:check` on **ubuntu / windows / macos × Node 22.x + 24.x**.
3. On success, **Auto-release** (ubuntu + Node 24 only):
   - Detects bump kind from commits since last `v*` tag
     (`feat:` → minor, `BREAKING CHANGE` / `type!:` → major, else patch).
   - Override with commit markers: `[release: major]`, `[release: minor]`,
     `[release: patch]`.
   - Skip with `[skip release]` in the commit message.
   - **Release plan** (`scripts/release-plan.mjs`): if `v{version}` tag already
     exists → skip; if `package.json` is already ahead of the last tag →
     **tag-only** (no second bump); else bump as usual. Prevents duplicate
     `chore(release)` commits that diverge developer clones.
   - Serialized with concurrency group `harness-auto-release-main`.
   - **Push** via `scripts/git-push-release.mjs`: `fetch` + `pull --rebase` +
     retry so concurrent main updates do not leave a bare non-fast-forward.
   - Runs `npm run bump` when needed; keeps version files + CHANGELOG promote
     (US-038) in sync.
   - Commits `chore(release): X.Y.Z` when files change, tags `vX.Y.Z`.
   - **npm publish** via **OIDC trusted publishing** with **`--provenance`**
     (green provenance check on npm when configured).
   - Creates a **GitHub Release** with notes from `CHANGELOG.md` plus optional
     export-changelog assist (`scripts/release-notes.mjs --with-export`) and
     attaches an **SPDX SBOM** (`sbom.spdx.json` from `npm sbom`).

### Pushing from a local clone (avoid non-fast-forward)

CI may land a `chore(release): …` commit on `main` while you work. Always
rebase before push:

```bash
npm run push          # fetch + pull --rebase + push (scripts/safe-push.mjs)
# equivalent:
git fetch origin && git pull --rebase origin main && git push
```

Do **not** `git push --force` to `main`.

`safe-push` correlates local commits before and after rebase by stable patch id
and atomically refreshes matching machine-local worklog commit references. It
preserves short/full hash length and leaves unmatched references unchanged with
a warning. If rebase conflicts, resolve them and rerun `npm run push`; the
pre-rebase mapping snapshot is retained under `.git/` until reconciliation
succeeds.

### Authentication (US-036 / decision 0018)

| Method | Role |
| --- | --- |
| **npm Trusted Publisher (OIDC)** | **Preferred** for CI publishes — short-lived tokens, automatic provenance |
| **`NPM_TOKEN` secret** | **Optional fallback** only (transition / emergency); not required when OIDC is configured |

**One-time setup on [npmjs.com](https://www.npmjs.com)** for package
**`5harness`** → Settings → **Trusted Publisher** (required for green
provenance on CI; after the package exists from a first publish):

| Field | Value |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `vantanminh` |
| Repository | `5harness` |
| Workflow filename | **`ci.yml`** (primary auto-release) |
| Environment name | leave empty unless you use GitHub Environments |

Day-to-day: push to `main` (or `npm run push`) — do **not** `npm publish`
from a laptop for production releases. CI uses `npm publish --provenance`.

Notes:

- npm allows **one** trusted publisher workflow filename per package. Prefer
  `ci.yml` for day-to-day auto-release; switch to `release.yml` only if you
  primarily publish via the Release workflow, or keep optional `NPM_TOKEN` for
  the non-primary path.
- Requires **npm CLI ≥ 11.5.1** on the runner (workflows install `npm@latest`)
  and job permission **`id-token: write`**.
- After OIDC works, consider restricting token-based publish on npm
  (Settings → Publishing access) and revoking long-lived automation tokens.
- `package.json` `repository.url` must match the GitHub repo used for OIDC.

### Manual

- **GitHub UI:** Actions → **Release** → Run workflow → choose patch/minor/major.
- **Local tag (no auto-bump):** ensure version files already match, then
  `git tag vX.Y.Z && git push origin vX.Y.Z` (tag must equal `package.json`).
- **Local publish fallback** (no provenance — OIDC provenance only works on CI):

  ```bash
  npm run release:check
  npm publish --access public
  # Do NOT use --provenance on a laptop: npm error
  # "Automatic provenance generation not supported for provider: null"
  ```

  Prefer re-running the **Auto-release** / **Release** GitHub Action after
  Trusted Publisher is configured for package `5harness`.

### Local version bump (optional)

```bash
npm run bump          # patch
npm run bump -- minor
npm run bump -- major
npm run bump -- 1.0.0
```

### Release notes helper

```bash
node scripts/release-notes.mjs            # package.json version → stdout
node scripts/release-notes.mjs 1.2.3 -o release-notes.md
# Include durable-history assist (stories/decisions) after CHANGELOG body:
node scripts/release-notes.mjs 1.2.3 --with-export -o release-notes.md
```

### CHANGELOG discipline (US-038)

- **Source of truth:** human-edited `CHANGELOG.md` (Keep a Changelog + semver).
- **On bump:** `scripts/bump-version.mjs` promotes non-empty `[Unreleased]` into
  `## [X.Y.Z] - YYYY-MM-DD` and leaves an empty Unreleased section. Release
  commits include `CHANGELOG.md`.
- **Assist only:** `harness export changelog` / `--with-export` on release notes
  append implemented stories/decisions; they do **not** replace human judgment.
- **Drafting:** run `harness export changelog [--since <date>]` when preparing
  Unreleased notes, then edit into Added/Changed/Fixed/Security sections.

## CI / CD

| Workflow | Trigger | What it does |
| --- | --- | --- |
| [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) | push/PR → `main` | `release:check` on **ubuntu + windows + macos × Node 22.x + 24.x** (US-035); on push to `main`, auto-bump + tag + **OIDC npm publish --provenance** + **GitHub Release** + SBOM (US-036) |
| [`.github/workflows/release.yml`](../../.github/workflows/release.yml) | tag `v*` **or** workflow_dispatch | Manual bump+publish, or publish when a human/PAT pushes a version tag — same OIDC/provenance/Release/SBOM path |

Actions are pinned to Node-24-ready major versions (`actions/checkout@v6`,
`actions/setup-node@v6`) and set `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` per
GitHub’s Node 20 → Node 24 Actions migration.

Publish jobs set `permissions: contents: write` and `id-token: write`.

## Consumer: verifying provenance

After a trusted publish, the package page on npm shows a provenance attestation
(“Built and signed on GitHub Actions”). Consumers can also use:

```bash
npm audit signatures
# or inspect the package on https://www.npmjs.com/package/5harness
```

GitHub Releases for each `vX.Y.Z` include release notes and `sbom.spdx.json`.

## Native engine (future)

If a native engine is added later:

- Keep the user-facing `harness` npm bin.
- Ship platform packages or downloadable artifacts with checksums.
- Document optionalDependencies / postinstall in a new decision.
