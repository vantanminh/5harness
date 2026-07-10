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
2. CI runs `release:check` on Node 22 + 24.
3. On success, **Auto-release**:
   - Detects bump kind from commits since last `v*` tag
     (`feat:` → minor, `BREAKING CHANGE` / `type!:` → major, else patch).
   - Override with commit markers: `[release: major]`, `[release: minor]`,
     `[release: patch]`.
   - Skip with `[skip release]` in the commit message.
   - Runs `npm run bump`, keeps `package.json`, `package-lock.json`,
     `src/version.ts`, and `<!-- harness-version -->` markers in sync.
   - Commits `chore(release): X.Y.Z`, tags `vX.Y.Z`, publishes to npm.

Requires repo secret **`NPM_TOKEN`** (npm Automation / granular publish token
for `@vantanminh/harness`).

### Manual

- **GitHub UI:** Actions → **Release** → Run workflow → choose patch/minor/major.
- **Local tag (no auto-bump):** ensure version files already match, then
  `git tag vX.Y.Z && git push origin vX.Y.Z` (tag must equal `package.json`).
- **Local publish fallback:** `npm run release:check && npm publish --access public`.

### Local version bump (optional)

```bash
npm run bump          # patch
npm run bump -- minor
npm run bump -- major
npm run bump -- 1.0.0
```

## CI / CD

| Workflow | Trigger | What it does |
| --- | --- | --- |
| [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) | push/PR → `main` | `release:check` on **Node 22.x + 24.x**; on push to `main`, auto-bump + tag + **npm publish** |
| [`.github/workflows/release.yml`](../../.github/workflows/release.yml) | tag `v*` **or** workflow_dispatch | Manual bump+publish, or publish when a human/PAT pushes a version tag |

Actions are pinned to Node-24-ready major versions (`actions/checkout@v6`,
`actions/setup-node@v6`) and set `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` per
GitHub’s Node 20 → Node 24 Actions migration.

## Native engine (future)

If a native engine is added later:

- Keep the user-facing `harness` npm bin.
- Ship platform packages or downloadable artifacts with checksums.
- Document optionalDependencies / postinstall in a new decision.
