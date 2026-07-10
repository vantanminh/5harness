# Harness (npm-native rewrite)

Independent **agent-ready repository harness**, redesigned so humans and agents
install and operate it with **npm** — not curl installers or manual binary
paths.

> The app is what users touch. The harness is what agents touch.

This repository is the product. It is **not** the upstream
`repository-harness` project. Upstream lives beside this repo only as a
**read-only reference**.

## Workspace

```text
npm-harness/                    # parent workspace
├── repository-harness/         # upstream reference (do not treat as product)
└── harness/                    # ← you are here (product)
```

Agents working in this repo must implement changes **here** and may read
`../repository-harness` for ideas, flows, and prior art. See `AGENTS.md`.

**Track implementation here:** [`docs/product/roadmap.md`](docs/product/roadmap.md)
(US-006 → US-014 after shipped US-001–US-005).

## Product Goal

Turn any software repo into an agent-ready workspace with:

1. **Clear agent entrypoints** — what to read before coding.
2. **Feature intake** — classify work (tiny / normal / high-risk) before edits.
3. **Story packets & decisions** — reviewable, **Git-backed** markdown history.
4. **Global CLI + project link** — install once; register many repos for a local
   dashboard; collaborators `clone` + `link` to pick up the same history.
5. **Agent index** — search/get/links so agents do not load whole vaults.
6. **Tools-only mutation** — agents never hand-edit operational markdown.

Product pivot: [decision 0011](docs/decisions/0011-global-tool-markdown-durable-index.md).

### Intended CLI (target contract)

```bash
# preferred: global install (package name: npm-harness)
npm i -g npm-harness
harness init                 # scaffold markdown + register project
# after git clone of a harnessed repo on another machine:
harness link

harness intake --type spec_slice --summary "..." --lane normal
harness story add --id US-001 --title "..." --lane normal
harness story update --id US-001 --status implemented --unit 1 --integration 1 --e2e 0 --platform 0
harness decision add --id 0001 --title "..." --doc docs/decisions/0001.md
harness backlog add --title "..." --risk tiny
harness query matrix
harness search "verify"
harness get US-001
harness links US-001

harness story verify US-001
harness trace --summary "..." --outcome completed --changed "src/a.ts" --agent me
harness audit
harness propose --commit
```

> **v0.5 shipped note:** the current binary still uses a per-project SQLite MVP
> for durable records. Decision 0011 locks the **next** store (markdown SoT +
> registry + index). Command *names* stay; persistence changes in the pivot.

### Local development (this repo)

```bash
cd harness
npm install
npm run build
npm test
npm run pack:check          # validate npm tarball contents + version sync
# or full gate: npm run release:check
node dist/cli.js init ./tmp-demo --dry-run
node dist/cli.js init ./tmp-demo
# or: npm run harness -- init ./tmp-demo
```

Users should **not** need:

- `install-harness.ps1` / `install-harness.sh`
- manual download of platform `.exe` / bare binaries
- a local Rust toolchain **to use** the product (build-from-source is a
  contributor path only)

## Relationship to Upstream

| Topic | Policy |
| --- | --- |
| Inspiration | Upstream operating model, durable concepts, command vocabulary |
| Code ownership | Clean rewrite in this repo |
| Distribution | npm `bin` (optional Rust engine as prebuilt native behind the bin) |
| Branding / docs | Original prose; do not republish upstream README as ours |
| Edits to upstream clone | Only if the human explicitly requests |

Primary reference docs (outside this tree):

- `../repository-harness/README.md`
- `../repository-harness/docs/HARNESS.md`
- `../repository-harness/docs/FEATURE_INTAKE.md`
- `../repository-harness/crates/harness-cli/`
- `../repository-harness/scripts/schema/`

## Current Status

| Area | Status |
| --- | --- |
| Product direction | Documented (`docs/product/overview.md`) |
| Operating harness for *this* repo | Installed (docs, AGENTS, bootstrap CLI for durable records) |
| Durable DB for *this* repo | Initialized (`harness.db`, gitignored) |
| Product npm package | **`npm-harness` v0.5.0** — bin `harness` |
| `harness init` / `harness migrate` | **Implemented** (US-001) |
| Durable commands (intake/story/decision/backlog/query) | **Implemented** (US-002) |
| `story verify`, trace, score-trace, audit | **Implemented** (US-003) |
| Release hardening (LICENSE, CHANGELOG, pack:check, CI) | **Implemented** (US-004) |
| `propose`, `query tools` | **Implemented** (US-005) |

User-facing install and durable ops use the product CLI (`npx harness …`).
Bootstrap `scripts/bin/harness-cli[.exe]` is legacy for this workspace only.

## Read First (agents)

1. `AGENTS.md` — identity, upstream rules, reading list  
2. `docs/product/overview.md` — product contract  
3. `docs/HARNESS.md` — collaboration loop  
4. `docs/FEATURE_INTAKE.md` — lanes before code  
5. `docs/ARCHITECTURE.md` — stack and layering for *this* product  
6. `docs/decisions/` — locked choices  

## v0 Scope

**In**

- npm-publishable CLI package
- `harness init` → operating files + SQLite durable layer in a target project
- Core durable commands: intake, story, decision, backlog, query, migrate
- Templates and agent shim suitable for multi-language target repos
- Clear docs for humans and agents

**Out (later)**

- Full upstream Phase 4/5 / Symphony parity
- Electron desktop controller
- Requiring Rust on the end-user machine

## Development Notes

- Stack and packaging decisions live under `docs/decisions/`.
- Product behavior lives under `docs/product/`.
- Story work lives under `docs/stories/`.
- Proof status: `.\scripts\bin\harness-cli.exe query matrix` (Windows bootstrap)
  until replaced by `npx harness query matrix`.

## License

See `LICENSE` if present; otherwise treat as private until declared.
