# Distribution

## Package

| Field | Value |
| --- | --- |
| npm name | `@vantanminh/harness` |
| bin | `harness` → `dist/cli.js` |
| GitHub | [vantanminh/harness](https://github.com/vantanminh/harness) |
| **Preferred install** | `npm i -g @vantanminh/harness` |
| Alternate install | `npm i -D @vantanminh/harness` + `npx harness …` |
| Node | `>=22.5.0` |
| License | MIT |

## Install story (product)

```bash
npm i -g @vantanminh/harness
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
   - Runs `npm run bump`, keeps `package.json`, `package-lock.json`,
     `src/version.ts`, and `<!-- harness-version -->` markers in sync, and
     promotes `CHANGELOG.md` `[Unreleased]` → `## [X.Y.Z] - date` when non-empty
     (US-038).
   - Commits `chore(release): X.Y.Z` (includes `CHANGELOG.md` when promoted),
     tags `vX.Y.Z`.
   - **npm publish** via **OIDC trusted publishing** with **`--provenance`**
     (green provenance check on npm when configured).
   - Creates a **GitHub Release** with notes from `CHANGELOG.md` plus optional
     export-changelog assist (`scripts/release-notes.mjs --with-export`) and
     attaches an **SPDX SBOM** (`sbom.spdx.json` from `npm sbom`).

### Authentication (US-036 / decision 0018)

| Method | Role |
| --- | --- |
| **npm Trusted Publisher (OIDC)** | **Preferred** for CI publishes — short-lived tokens, automatic provenance |
| **`NPM_TOKEN` secret** | **Optional fallback** only (transition / emergency); not required when OIDC is configured |

**One-time setup on [npmjs.com](https://www.npmjs.com)** for package
`@vantanminh/harness` → Settings → Trusted Publisher:

| Field | Value |
| --- | --- |
| Provider | GitHub Actions |
| Organization or user | `vantanminh` |
| Repository | `harness` |
| Workflow filename | `ci.yml` (primary auto-release) **or** `release.yml` (manual/tag path) |
| Environment name | leave empty unless you use GitHub Environments |

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
- **Local publish fallback:** `npm run release:check && npm publish --access public`
  (uses your interactive/npm login — not OIDC).

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
# or inspect the package on https://www.npmjs.com/package/@vantanminh/harness
```

GitHub Releases for each `vX.Y.Z` include release notes and `sbom.spdx.json`.

## Native engine (future)

If a native engine is added later:

- Keep the user-facing `harness` npm bin.
- Ship platform packages or downloadable artifacts with checksums.
- Document optionalDependencies / postinstall in a new decision.
