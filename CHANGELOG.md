# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- npm update notices now refresh the `latest` dist-tag hourly, bypass
  intermediary caches, and retry transient registry failures after five
  minutes instead of preserving a stale result for a full day (IN-011 / US-049).

## [0.15.1] - 2026-07-13

### Fixed

- OAuth approval pages now allow the exact registered callback origin in their
  `form-action` CSP, so the authorization endpoint's 302 can reach loopback
  clients running on another port without permitting arbitrary form targets
  (IN-010 / US-048).

## [0.15.0] - 2026-07-13

### Added

- OAuth 2.1 authentication for standalone and dashboard-hosted MCP: RFC 9728
  and RFC 8414 discovery, dynamic public-client registration, Authorization
  Code with mandatory PKCE S256, and short-lived resource-bound Bearer tokens
  (IN-009 / US-045–US-047 / decision 0019).

### Security

- MCP calls now require an OAuth access token; dashboard session cookies do not
  grant MCP access. Plain HTTP is loopback-only, while non-loopback binds require
  an explicit canonical HTTPS `--public-url` behind a TLS reverse proxy.

## [0.12.6] - 2026-07-12

### Changed

- **Breaking (solo-dev cleanup):** drop all legacy storage fallbacks for the old
  `harness` identity. Runtime paths are **only** `5harness`:
  - Global home: **`~/.5harness`** only (`HARNESS_HOME` override still works).
  - Project state: **`.5harness/`** only (index, local traces, locks, logs).
  - Backups: **`.5harness-backup/`**; log file **`5harness.log`**.
  - Old `~/.harness` / `.harness/` directories are **ignored** — delete or
    rename them manually if still on disk.
- Scaffold / root `.gitignore` no longer list dual `.harness` rules.

## [0.12.5] - 2026-07-12

### Changed

- Patch release after path rename line (tag `v0.12.5`); see `0.12.4` notes for
  GitHub repo rename and initial `.5harness` storage identity.

## [0.12.4] - 2026-07-12

### Changed

- GitHub repository renamed **`vantanminh/harness` → `vantanminh/5harness`**.
  Update clone URLs, npm Trusted Publisher repo field, and package.json
  `repository` / badges / release notes links.
- **Storage paths** renamed to the `5harness` identity (with temporary legacy
  fallback in that release):
  - Global home: **`~/.5harness`** (was `~/.harness`).
  - Project derived state: **`.5harness/`**.
  - Backups: **`.5harness-backup/`**; log file **`5harness.log`**.
- Package bins: **`harness`** and **`5harness`** both point at `dist/cli.js`.

## [0.12.2] - 2026-07-12

### Added

- README production overhaul (US-039): badges, quickstart, features table,
  agent rules summary, security + changelog links.
- CHANGELOG discipline (US-038): Keep a Changelog promote of `[Unreleased]`
  on version bump; release notes `--with-export` durable-history assist;
  backfill/version hygiene for the 0.10–0.12 line.

### Changed

- **Breaking install UX (US-040 / decision 0016):** npm package renamed from
  `@vantanminh/harness` to **`5harness`**. Bin remains **`harness`**.
  Migration: `npm i -g 5harness`. See [docs/DEPRECATION.md](docs/DEPRECATION.md).
- MCP expands beyond read-only tools (US-041): `harness_intake`,
  `harness_story_add` / `harness_story_update`, `harness_decision_add`,
  `harness_backlog_add`, plus `harness_reindex` and `harness_doctor` — all via
  the same application layer as the CLI (local-only).
- CI auto-release is race-safe: concurrency lock, `release-plan` (skip /
  tag-only / bump), rebase-retry push (`git-push-release.mjs`). Developers use
  `npm run push` (`safe-push.mjs`) to avoid non-fast-forward on main.
- Agent **hard-fail contract** in `templates/AGENTS.md` (decision 0017 /
  US-032): HARD STOP on harness CLI/MCP failure, recovery via
  `doctor` / `link` / `reindex`, no hand-edit fallback for durable entities.
- Structured errors and debug logging (US-033): `HARNESS_E_*` codes on CLI
  failures, `HARNESS_JSON_ERRORS`, `HARNESS_DEBUG` / `HARNESS_LOG_FILE`,
  secret redaction, doctor `logs` check.
- Index integrity (US-034): atomic `index.json` writes, SHA-256 checksum +
  schema version, project mutation lock, doctor `index-integrity` (corrupt /
  missing entities / broken links).
- CI multi-OS matrix (US-035): `ubuntu-latest`, `windows-latest`, `macos-latest`
  × Node `22.x` / `24.x` for full `release:check` (decision 0018).
- Production releases (US-036): npm **trusted publishing (OIDC)** with
  **`npm publish --provenance`**, optional `NPM_TOKEN` fallback, **GitHub
  Releases** (notes via `scripts/release-notes.mjs` from CHANGELOG), and
  **SPDX SBOM** asset (`npm sbom`) on each release (decision 0018).
- Security policy (US-037): root **SECURITY.md** (reporting + supported
  versions), expanded **docs/SECURITY.md** trust model, Dependabot
  (npm + Actions), `publishConfig.provenance`, SECURITY in npm tarball,
  loopback bind helper + MCP/dashboard warnings.

### Changed

- CI/CD auto-bumps semver on every push to `main` (after tests pass), commits
  `chore(release): X.Y.Z`, tags, and publishes to npm via OIDC + provenance
  when trusted publisher is configured (US-036). Bump kind is inferred from
  commits since the last tag (`feat` → minor, breaking → major, else patch);
  override with `[release: major|minor|patch]` or skip with `[skip release]`.
  Manual release via Actions workflow_dispatch remains available. Version sync
  now includes `templates/AGENTS.md` harness-version marker
  (`scripts/bump-version.mjs`, `pack:check`). `CHANGELOG.md` is committed on
  release when Unreleased content is promoted (US-038).

## [0.12.0] - 2026-07-10

### Added

- MCP monitoring foundation (IN-004 / US-031): call records, instrumented MCP
  server, dashboard API routes and monitoring UI (call log, stats).

## [0.11.1] - 2026-07-10

### Changed

- MCP transport: HTTP integrated with the local dashboard (replaces stdio-only
  for dashboard-hosted MCP).

## [0.11.0] - 2026-07-10

### Added

- `harness mcp` — MCP server for agent integration (US-027/E14).
- `harness export changelog [--since] [--json]` — Derive changelog notes from
  implemented stories/decisions (assist only). (US-028/E14)
- `harness watch` — Watch entity directories and auto-reindex on markdown
  changes (debounced 500ms). Fail-open, no durable mutation. (US-029/E14)
- `harness handoff [--story <id>] [--json]` — Session summary for the next
  agent (US-030/E14).

### Fixed

- Frontmatter parser strips `\r` to handle `\r\n` line endings on Windows.

## [0.10.2] - 2026-07-10

### Added

- Dashboard mutations only via CLI code paths (US-026/E13).
- `harness intake run` structured intake pipeline (US-025/E13).
- Worklog and PR/commit linkage (US-024/E13).
- Story lifecycle verbs: start / done / block (US-023/E13).

## [0.10.1] - 2026-07-10

### Added

- Inbound tool registry: register / check / remove (US-022/E12).
- `harness context` — budgeted entity context pack (US-021/E12).
- `harness next` — recommend next work item (US-020/E12).
- `harness status` — project snapshot for agents (US-019/E12).
- `harness doctor` — workspace health checks (US-018/E12).

## [0.10.0] - 2026-07-10

### Added

- `harness docs` command group for AI agent documentation access.
- Auto-bump version and publish to npm on main (CI).
- Docs included in npm package for global `harness docs`.

### Changed

- CI/CD auto-bumps semver on main after tests; version sync includes
  `templates/AGENTS.md` harness-version marker.

### Fixed

- Suppress `node:sqlite` ExperimentalWarning via lazy-loading.
- Eliminate DEP0190 deprecation warning on `child_process` with `shell: true`.

## [0.9.7] - 2026-07-10

### Added

- `harness update` with package-manager detection.

### Fixed

- Suppress ExperimentalWarning from `node:sqlite` import path.

## [0.9.6] - 2026-07-10

### Added

- Version tracking in repos and smart upgrade system (US-016).
- Auto-reindex after mutation commands (US-015).
- Agent rules + dev conventions update (US-017).

## [0.9.5] - 2026-07-10

### Added

- Dashboard: richer project views, entity detail, dark mode, version footer.
- Bare `harness` (no subcommand) starts the dashboard.

## [0.9.4] - 2026-07-10

### Added

- `harness init` now auto-reindexes after scaffolding so queries work
  immediately without a manual `harness reindex` step (Decision 0012).

### Changed

- CI now auto-tags and publishes to npm on push to main when `package.json`
  version changes (no more manual `git tag` + push needed).

## [0.9.3] - 2026-07-10

### Added

- CLI version flags: `-v` and `-V` alongside `--version`.

### Changed

- GitHub Actions: Node 24-ready CI (`checkout@v6`, `setup-node@v6`, matrix
  Node 22.x + 24.x); optional Release workflow publishes on `v*` tags via
  `NPM_TOKEN`.

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
  [github.com/vantanminh/5harness](https://github.com/vantanminh/5harness).
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
- `.gitignore` rules for `.5harness/index/` and `.5harness/local/`.
- Target templates: markdown SoT + tools-only agent policy (US-010/011).
- Quality on markdown store (US-012): verify updates entity frontmatter; traces in
  `.5harness/local/traces.jsonl`; audit/propose/query traces without project SQLite.

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
- Derived index at `.5harness/index/index.json` (catalog + edges + search text).
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
- `HARNESS_HOME` env (default `~/.5harness`) stores `registry.json`.
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

[Unreleased]: https://github.com/vantanminh/5harness/compare/v0.12.0...HEAD
[0.12.0]: https://github.com/vantanminh/5harness/compare/v0.11.1...v0.12.0
[0.11.1]: https://github.com/vantanminh/5harness/compare/v0.11.0...v0.11.1
[0.11.0]: https://github.com/vantanminh/5harness/compare/v0.10.2...v0.11.0
[0.10.2]: https://github.com/vantanminh/5harness/compare/v0.10.1...v0.10.2
[0.10.1]: https://github.com/vantanminh/5harness/compare/v0.10.0...v0.10.1
[0.10.0]: https://github.com/vantanminh/5harness/compare/v0.9.7...v0.10.0
[0.9.7]: https://github.com/vantanminh/5harness/compare/v0.9.6...v0.9.7
[0.9.6]: https://github.com/vantanminh/5harness/compare/v0.9.5...v0.9.6
[0.9.5]: https://github.com/vantanminh/5harness/compare/v0.9.4...v0.9.5
[0.9.4]: https://github.com/vantanminh/5harness/compare/v0.9.3...v0.9.4
[0.5.0]: https://github.com/vantanminh/5harness/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/vantanminh/5harness/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/vantanminh/5harness/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/vantanminh/5harness/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/vantanminh/5harness/releases/tag/v0.1.0
