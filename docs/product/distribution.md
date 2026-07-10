# Distribution

## Package

| Field | Value |
| --- | --- |
| npm name | `npm-harness` |
| bin | `harness` → `dist/cli.js` |
| **Preferred install** | `npm i -g npm-harness` |
| Alternate install | `npm i -D npm-harness` + `npx harness …` |
| Node | `>=22.5.0` (may relax if `node:sqlite` is no longer required for SoT) |
| License | MIT |

## Install story (product)

```bash
npm i -g npm-harness
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

It must **not** require a local Rust toolchain for normal use.

> Note: v0.5 still ships `migrations/**` for the SQLite MVP. After the
> markdown-store rewrite, published SQL migrations for project SoT go away;
> optional index engines stay internal to the package.

## Release checklist

1. `npm run typecheck`
2. `npm test`
3. `npm run build`
4. `npm run pack:check`
5. Bump `package.json` + `src/version.ts` together; update `CHANGELOG.md`
6. Tag `vX.Y.Z` when publishing (optional until public registry is chosen)
7. `npm publish` (when registry access is configured)

## CI

GitHub Actions workflow `.github/workflows/ci.yml` runs the same checks on
push/PR for `master` / `main`.

## Native engine (future)

If a Rust (or other native) engine is added later:

- Keep the user-facing `harness` npm bin.
- Ship platform packages or downloadable artifacts with checksums.
- Document optionalDependencies / postinstall in a new decision.
