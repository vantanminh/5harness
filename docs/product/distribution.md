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

1. `npm run release:check` (typecheck + test + pack:check)
2. Bump `package.json` + `src/version.ts` together; update `CHANGELOG.md`
3. Commit and push to `main`
4. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`
5. **CD:** GitHub Actions `Release` workflow publishes to npm when secret
   `NPM_TOKEN` is set (Automation/granular token with publish on
   `@vantanminh/harness`). Without it the Release job fails early with
   `ENEEDAUTH` / missing secret — use local publish instead:
   `npm publish --access public` (OTP if 2FA).

## CI / CD

| Workflow | Trigger | What it does |
| --- | --- | --- |
| [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) | push/PR → `main` | `npm ci` + `release:check` on **Node 22.x and 24.x** |
| [`.github/workflows/release.yml`](../../.github/workflows/release.yml) | tag `v*` | `release:check` then `npm publish` (secret `NPM_TOKEN`) |

Actions are pinned to Node-24-ready major versions (`actions/checkout@v6`,
`actions/setup-node@v6`) and set `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` per
GitHub’s Node 20 → Node 24 Actions migration.

## Native engine (future)

If a native engine is added later:

- Keep the user-facing `harness` npm bin.
- Ship platform packages or downloadable artifacts with checksums.
- Document optionalDependencies / postinstall in a new decision.
