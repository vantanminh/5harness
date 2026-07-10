# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.9.2] - 2026-07-10

### Added

- Optional npm update notice: at most one registry check per 24h (cache under
  `~/.harness/update-check.json`), fail-open, stderr-only, disabled in CI or via
  `HARNESS_NO_UPDATE_CHECK=1`. No auto-upgrade.

## [0.9.1] - 2026-07-10

### Security

- Harden `runVerifyCommand`: validate command (length, no null/newlines) and
  cwd; add timeout, maxBuffer, `windowsHide`. Document trust model in
  `docs/SECURITY.md` (verify strings are project-authored proof commands).

### Changed

- Package identity: npm `@vantanminh/harness`, repo
  [github.com/vantanminh/harness](https://github.com/vantanminh/harness).
  Scoped publish uses `publishConfig.access: public`. Bin remains `harness`.
- Docs and agent guidance describe this product as standalone; removed bootstrap
  binary paths and third-party layout coupling. README keeps a brief credit.

## [0.9.0] - 2026-07-10

### Added

- `harness dashboard` — localhost read-only multi-project browser UI + JSON API
  (`/api/projects`, `/api/project?id=`) from global registry + markdown catalog (US-014).

## [0.8.0] - 2026-07-10

### Added

- Init registers project in global registry; ensures entity dirs (stories/decisions/intakes/backlog).
- `.gitignore` rules for `.harness/index/` and `.harness/local/`.
- Target templates: markdown SoT + tools-only agent policy (US-010/011).
- Quality on markdown store (US-012): verify updates entity frontmatter; traces in
  `.harness/local/traces.jsonl`; audit/propose/query traces without project SQLite.

### Fixed

- YAML frontmatter correctly round-trips JSON-escaped strings (e.g. verify commands).

### Changed

- **Breaking (US-013):** project `harness.db` is no longer created by `init` and is not
  the operational SoT. Durable writes are markdown-only (no dual-write).
- `harness migrate` only touches an existing legacy DB (or reports none).
- Added `harness import-sqlite` for one-shot conversion (skips existing entities
  unless `--force`).

## [0.7.2] - 2026-07-10

### Added

- Agent index tools (US-009): `harness reindex`, `get`, `search`, `links`.
- Derived index at `.harness/index/index.json` (catalog + edges + search text).
- `harness link` auto-reindexes when a markdown entity store is present.
- Wikilink parsing (`[[id]]`) for link graph.

## [0.7.1] - 2026-07-10

### Added

- Markdown-backed query views (US-008): matrix/stats/entity lists from catalog.
- Shared `buildCatalog()` scanner; queries no longer require `harness.db`.

## [0.7.0] - 2026-07-10

### Added

- Markdown entity store writes for intake, story, decision, backlog:
  - `docs/stories/<id>.md`, `docs/decisions/<id>.md`, `docs/intakes/IN-###.md`,
    `docs/backlog/BL-###.md` with YAML frontmatter (`id`, `type`, …).
- Optional `--links <csv>` on write commands for entity graph edges.
- Atomic entity file writes; works **without** `harness.db` (MD-only).
- Dual-write to SQLite when `harness.db` exists (transition until US-008/013).

### Changed

- CLI durable write commands no longer require an existing database.
- Intake/backlog display ids use `IN-###` / `BL-###` (SQLite numeric id still
  dual-written when DB present).

## [0.6.0] - 2026-07-10

### Added

- `harness link [path]` — register a project in the machine-local global registry.
- `harness unlink [path]` — remove registry entry (does not delete project files).
- `harness projects` — list linked projects; warns when paths are missing.
- `HARNESS_HOME` env (default `~/.harness`) stores `registry.json`.
- Unit + CLI e2e tests with isolated `HARNESS_HOME`.

### Changed

- Product direction locked in decision **0011** (docs/roadmap in prior commit):
  global-first install, markdown durable SoT next, registry for multi-project
  discovery and clone→link workflow.

## [0.5.0] - 2026-07-10

### Added

- `harness propose` and `harness propose --commit` (audit → improvement proposals / backlog).
- `harness query tools` built-in tool registry (`--capability`, `--status` filters).

## [0.4.0] - 2026-07-10

### Added

- Release hardening: `LICENSE`, `CHANGELOG.md`, distribution product doc.
- `npm run pack:check` validates published tarball contents (bin, templates, migrations).
- GitHub Actions CI workflow: install, typecheck, test, build, pack:check.
- Package metadata for publish readiness (`engines`, `files`, keywords).

## [0.3.0] - 2026-07-10

### Added

- Phase C quality commands: `story verify`, `story verify-all`, `decision verify`.
- `trace`, `score-trace`, `audit`, `query traces`.
- Schema migration `002-quality.sql` (story last_verified_*, trace friction).

## [0.2.0] - 2026-07-10

### Added

- Phase B durable commands: `intake`, `story add|update`, `decision add`.
- `backlog add|close`, `query matrix|stats|intakes|decisions|stories|backlog`.

## [0.1.0] - 2026-07-10

### Added

- Initial npm package `npm-harness` with bin `harness`.
- `harness init` Phase A payload + SQLite migrate via `node:sqlite`.
- `harness migrate`, templates manifest, vitest suite.

[0.5.0]: https://github.com/local/npm-harness/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/local/npm-harness/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/local/npm-harness/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/local/npm-harness/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/local/npm-harness/releases/tag/v0.1.0
