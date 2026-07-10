# Harness

**Agent-ready repository harness** — a global npm CLI that turns any software
repo into a structured workspace for humans and coding agents.

> The app is what users touch. The harness is what agents touch.

**Package:** [`@vantanminh/harness`](https://www.npmjs.com/package/@vantanminh/harness)  
**Source:** [github.com/vantanminh/harness](https://github.com/vantanminh/harness)

## Install

```bash
npm i -g @vantanminh/harness
```

Requires **Node.js ≥ 22.5**.

## Quick start

```bash
cd /path/to/project
harness init                 # scaffold markdown + register this project
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
harness dashboard

harness story verify US-001
harness trace --summary "..." --outcome completed --changed "src/a.ts" --agent me
harness audit
harness propose --commit
```

## What you get

1. **Clear agent entrypoints** — what to read before coding.
2. **Feature intake** — classify work (tiny / normal / high-risk) before edits.
3. **Story packets & decisions** — reviewable, **Git-backed** markdown history.
4. **Global CLI + project link** — install once; register many repos; collaborators
   `clone` + `link` to pick up the same history.
5. **Agent index** — search / get / links so agents do not load whole vaults.
6. **Tools-only mutation** — agents change operational markdown only via CLI tools.
7. **Local dashboard** — multi-project browser UI over the machine registry.

Product pivot: [decision 0011](docs/decisions/0011-global-tool-markdown-durable-index.md).

## Local development

```bash
npm install
npm run build
npm test
npm run pack:check          # validate npm tarball contents + version sync
# or full gate: npm run release:check
node dist/cli.js init ./tmp-demo --dry-run
node dist/cli.js init ./tmp-demo
# or: npm run harness -- init ./tmp-demo
```

## CI / CD

- **CI** (push/PR): typecheck, tests, pack check on Node **22** and **24**
- **Auto-release** (push to `main`): bumps version, tags `vX.Y.Z`, publishes to
  npm when secret `NPM_TOKEN` is set (skip with `[skip release]` in the commit)
- **Manual release:** Actions → Release → Run workflow (patch/minor/major), or
  push a matching tag — see `docs/product/distribution.md`

## Current status

| Area | Status |
| --- | --- |
| npm package | **`@vantanminh/harness` v0.9.3** — bin `harness` |
| `init` / `link` / registry | Shipped |
| Markdown durable SoT | Shipped (stories, decisions, intakes, backlog) |
| Query + agent index | Shipped (`query`, `search`, `get`, `links`, `reindex`) |
| Quality (verify / trace / audit / propose) | Shipped |
| Local dashboard | Shipped |
| Legacy SQLite import | Optional (`harness import-sqlite`) |

## Read first (agents)

1. `AGENTS.md` — identity and reading list  
2. `docs/product/overview.md` — product contract  
3. `docs/HARNESS.md` — collaboration loop  
4. `docs/FEATURE_INTAKE.md` — lanes before code  
5. `docs/ARCHITECTURE.md` — stack and layering  
6. `docs/decisions/` — locked choices  
7. `docs/product/roadmap.md` — implementation tracking  

## Update notices

The CLI may print a one-line notice on stderr when a newer npm version exists
(cached at most once per day under `~/.harness/`). Disable with
`HARNESS_NO_UPDATE_CHECK=1` (also auto-disabled when `CI=true`).

## Security

`harness story verify` runs the **project-authored** `verify` command from story
markdown (intentional local proof, like CI scripts). See
[docs/SECURITY.md](docs/SECURITY.md).

## License

MIT — see `LICENSE`.

## Acknowledgments

Thanks to the authors of [repository-harness](https://github.com/hoangnb24/repository-harness) for ideas we studied while designing this product.
