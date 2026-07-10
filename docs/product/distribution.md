# Distribution

## Package

| Field | Value |
| --- | --- |
| npm name | `npm-harness` |
| bin | `harness` → `dist/cli.js` |
| Install | `npm i -D npm-harness` then `npx harness …` |
| Node | `>=22.5.0` (uses `node:sqlite`) |
| License | MIT |

## Published artifacts

The npm tarball **must** include:

- `dist/**` (compiled CLI, shebang on `dist/cli.js`)
- `templates/**` (init payload + `manifest.json`)
- `migrations/**` (`*.sql`)
- `package.json`, `README.md`, `LICENSE`

It must **not** require a local Rust toolchain or ship platform `.exe` binaries
for Phase D (pure JS + Node built-in SQLite).

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

Phase D does **not** introduce native artifacts.
