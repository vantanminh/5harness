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

## Product Goal

Turn any software repo into an agent-ready workspace with:

1. **Clear agent entrypoints** — what to read before coding.
2. **Feature intake** — classify work (tiny / normal / high-risk) before edits.
3. **Story packets & decisions** — reviewable, inheritable work.
4. **Durable layer** — SQLite operational state (stories, traces, queries).
5. **npm-native UX** — one CLI surface for install and day-to-day use.

### Intended CLI (target contract)

```bash
# preferred: project-local
npm i -D @harness/cli          # package name TBD; pin version per project
npx harness init               # install operating files + init DB in target repo
npx harness intake --type ... --summary ... --lane normal
npx harness story add --id US-001 --title "..." --lane normal
npx harness story update --id US-001 --unit 1 --integration 1
npx harness story verify US-001
npx harness decision add --id 0001 --title "..." --doc docs/decisions/0001.md
npx harness query matrix
npx harness audit
```

Global install (`npm i -g ...`) is optional convenience. **Version pinning via
devDependency + `npx`** is preferred for reproducible agent runs.

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
| Operating harness for *this* repo | Installed (docs, AGENTS, temporary bootstrap CLI) |
| Durable DB for *this* repo | Initialized (`harness.db`, gitignored) |
| Product npm package / `harness` CLI | **Not implemented yet** |
| Target-project installer via npm | **Not implemented yet** |

Bootstrap: while the product CLI is missing, maintainers may use
`scripts/bin/harness-cli[.exe]` (temporary upstream binary) only to record
intakes, stories, and decisions **for this repository**. That path is not the
user-facing contract.

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
