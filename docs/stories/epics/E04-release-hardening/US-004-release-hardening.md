# US-004 Phase D release hardening

## Status

implemented

## Lane

normal

## Product Contract

A maintainer can validate that `npm-harness` is ready to pack/publish: legal
files, changelog, package metadata, automated pack content checks, and CI.

## Acceptance Criteria

- `LICENSE` (MIT) present and listed in package `files`.
- `CHANGELOG.md` covers 0.1.0–current release notes.
- `docs/product/distribution.md` documents install, pack contents, release steps.
- `npm run pack:check` fails if tarball misses bin/templates/migrations/LICENSE.
- CI workflow runs typecheck, test, build, pack:check on Node 22+.
- Package version is `0.4.0` aligned with `src/version.ts`.
- README points to publish/check workflow.
- Tests cover pack:check script success path.

## Design Notes

- No multi-platform native builds in this story (not applicable yet).
- Prefer script-based pack inspection over full publish dry-run to registry.

## Evidence

```text
npm test
npm run pack:check
npm run release:check
```
