# Harness

**Agent-ready repository harness** — a global npm CLI that turns any software
repo into a structured workspace for humans and coding agents.

> The app is what users touch. The harness is what agents touch.

[![CI](https://github.com/vantanminh/harness/actions/workflows/ci.yml/badge.svg)](https://github.com/vantanminh/harness/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@vantanminh/harness.svg)](https://www.npmjs.com/package/@vantanminh/harness)
[![Node.js](https://img.shields.io/node/v/@vantanminh/harness.svg)](https://www.npmjs.com/package/@vantanminh/harness)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Provenance](https://img.shields.io/badge/npm-provenance-green)](https://docs.npmjs.com/generating-provenance-statements)

| | |
| --- | --- |
| **Package** | [`@vantanminh/harness`](https://www.npmjs.com/package/@vantanminh/harness) |
| **Bin** | `harness` |
| **Source** | [github.com/vantanminh/harness](https://github.com/vantanminh/harness) |
| **Node** | ≥ 22.5 |
| **License** | [MIT](LICENSE) |

## Install

Preferred (global — multi-project + dashboard):

```bash
npm i -g @vantanminh/harness
harness --version
```

Project-local (optional):

```bash
npm i -D @vantanminh/harness
npx harness --help
```

Releases use **npm trusted publishing (OIDC)** with **provenance** when
configured. See [docs/product/distribution.md](docs/product/distribution.md).

## Quick start

```bash
cd /path/to/project
harness init                 # scaffold markdown + register this project
# after git clone of a harnessed repo on another machine:
harness link                 # register path + reindex committed history

harness intake --type spec_slice --summary "Add export API" --lane normal
harness story add --id US-001 --title "Export API" --lane normal
harness story update --id US-001 --status implemented --unit 1 --integration 1 --e2e 0 --platform 0
harness decision add --id 0001 --title "Use markdown SoT" --doc docs/decisions/0001.md
harness query matrix
harness search "export"
harness get US-001
harness links US-001
harness doctor
harness next
harness dashboard            # or bare: harness
```

## Features

| Feature | What it does |
| --- | --- |
| **Init / link** | Scaffold agent docs + markdown entities; register project in `~/.harness` |
| **Durable history** | Stories, decisions, intakes, backlog as **Git-backed** markdown |
| **Agent index** | `search` / `get` / `links` / `reindex` — no whole-vault dumps |
| **Tools-only mutation** | Agents change operational entities **only** via CLI (or MCP tools) |
| **Quality loop** | `verify`, `trace`, `audit`, `propose` |
| **Agent loop** | `doctor`, `status`, `next`, `context`, `handoff`, `watch` |
| **MCP** | Local `harness mcp` / dashboard MCP for Cursor/Claude-class agents |
| **Dashboard** | Localhost multi-project UI + optional MCP monitoring |
| **Releases** | CI multi-OS matrix, OIDC publish, GitHub Releases, SBOM |

Product pivot: [decision 0011](docs/decisions/0011-global-tool-markdown-durable-index.md).

## Agent rules (summary)

1. **Read first:** `AGENTS.md`, `docs/HARNESS.md`, `docs/FEATURE_INTAKE.md`,
   active story under `docs/stories/`.
2. **Mutate only via tools:** `harness intake` / `story` / `decision` /
   `backlog` — **never** hand-edit operational entity markdown.
3. **Hard-fail (decision 0017):** if harness CLI or MCP fails for a required
   step → **HARD STOP**. Recover with `doctor` / `link` / `reindex`, then
   retry. Do not bypass with hand-edits.
4. **Prefer queries:** `search`, `get`, `links`, `query matrix|stats`, `next`.

Full contract: [AGENTS.md](AGENTS.md) · [docs/CONTEXT_RULES.md](docs/CONTEXT_RULES.md).

## Security

- **Report vulnerabilities** privately — [SECURITY.md](SECURITY.md)
- **Trust model** (verify commands, MCP local-only, registry paths, secrets,
  provenance for consumers): [docs/SECURITY.md](docs/SECURITY.md)

`harness story verify` runs the **project-authored** `verify` command from story
markdown (intentional local proof, like CI scripts).

## Changelog

Notable changes: [CHANGELOG.md](CHANGELOG.md) (Keep a Changelog + semver).

Draft assist from durable history:

```bash
harness export changelog [--since 2026-07-01]
```

## Current status

| Area | Status |
| --- | --- |
| npm package | **`@vantanminh/harness`** — bin `harness` (see roadmap for `5harness` rename) |
| `init` / `link` / registry | Shipped |
| Markdown durable SoT | Shipped |
| Query + agent index | Shipped |
| Quality (verify / trace / audit / propose) | Shipped |
| Agent-loop tools (doctor / status / next / …) | Shipped |
| MCP (read tools; mutations expanding) | Shipped |
| Local dashboard + MCP monitor | Shipped |
| CI multi-OS + OIDC provenance releases | Shipped |
| Legacy SQLite import | Optional (`harness import-sqlite`) |

## Local development

```bash
npm install
npm run build
npm test
npm run pack:check          # tarball + version sync
# full gate:
npm run release:check
node dist/cli.js --help
# or: npm run harness -- --help
```

## CI / CD

- **CI** (push/PR): `release:check` on **ubuntu / windows / macos × Node 22 + 24**
- **Auto-release** (push to `main`): bump, tag, **OIDC npm publish --provenance**,
  GitHub Release + SBOM (skip with `[skip release]`)
- **Manual:** Actions → Release, or matching `v*` tag

Details: [docs/product/distribution.md](docs/product/distribution.md).

## Read first (agents & contributors)

1. [AGENTS.md](AGENTS.md) — identity, mutation rules, hard-fail  
2. [docs/product/overview.md](docs/product/overview.md) — product contract  
3. [docs/HARNESS.md](docs/HARNESS.md) — collaboration loop  
4. [docs/FEATURE_INTAKE.md](docs/FEATURE_INTAKE.md) — lanes before code  
5. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — stack and layering  
6. [docs/decisions/](docs/decisions/) — locked choices  
7. [docs/product/roadmap.md](docs/product/roadmap.md) — implementation tracking  

## Update notices

The CLI may print a one-line notice on stderr when a newer npm version exists
(cached at most once per day under `~/.harness/`). Disable with
`HARNESS_NO_UPDATE_CHECK=1` (also auto-disabled when `CI=true`).

```bash
harness update    # reinstall latest with detected package manager
harness upgrade   # refresh harness block in project AGENTS.md
```

## License

MIT — see [LICENSE](LICENSE).

## Acknowledgments

Thanks to the authors of
[repository-harness](https://github.com/hoangnb24/repository-harness) for ideas
we studied while designing this product.
