# Architecture

## Stack Direction (this product)

| Concern | Direction |
| --- | --- |
| Product surface | CLI first (`harness` via npm `bin`); local dashboard later |
| Preferred install | `npm i -g 5harness` (project-local `npx` allowed) |
| User runtime | Node.js + npm |
| Implementation language | TypeScript today; native engine optional later |
| **Durable SoT** | **Markdown entities in each project** (Git-backed) — decision 0011 |
| Derived index | `.5harness/index/` rebuildable; atomic write + checksum (US-034); may use SQLite FTS internally |
| Mutation lock | `.5harness/mutation.lock` during index write (stale reclaim ~30s) |
| Global registry | `HARNESS_HOME` / `~/.5harness` project pointers only |
| Project Link | Git-tracked peer ids + machine-local registry resolution; no cloud graph |
| Traces | Machine-local (not default Git) |
| Packaging | npm package; optional native packages later |
| Project SQLite as SoT | **Retired** (was v0.5 MVP; supersedes decision 0004 for this product) |

Record locking choices under `docs/decisions/`.

## System Context

```text
Human / Agent
    |
    v
npm i -g  →  harness CLI
    |
    +--→ HARNESS_HOME (~/.5harness)
    |      registry.json  (linked project paths)
    |      optional caches / local traces per project id
    |
    +--→ Target project filesystem
           AGENTS.md, docs/ policy
           docs/stories|decisions|intakes|backlog|reports/*.md   ← SoT (git)
           .5harness/index/   ← derived (gitignore)
           .5harness/local/   ← traces etc (gitignore)
    |
    +--→ (future) localhost dashboard
           reads registry + project markdown/index
```

Collaborator:

```text
git clone (gets MD history) → harness link → reindex → CLI/dashboard ready
```

Opt-in Project Link:

```text
calling project AGENTS.md
  role/stack + configured peer ids (git)
       |
       +--> ~/.5harness registry: peer id -> same-machine path
       |         |
       |         +--> peer index: bounded search/get/context/links (read)
       |
       +------------> peer docs/reports/RP-###.md (create only)
                         target-owned lifecycle + target reindex
```

Peer selectors never accept arbitrary roots or perform peer-of-peer traversal.
For MCP, OAuth first binds the calling project; `peer_id`, `role`, `to`, and
`from` then select only that project's configured capabilities. They do not
replace the single-project consent selection or the all-projects
`X-Harness-Project`/`?project=` caller selector.

## Discovery Before Shape

Before proposing implementation shape for a story, identify:

- Product surfaces: CLI; later dashboard.
- Core domains: init/link/registry, entity store, index/search, intake/story/
  decision/backlog, verify/trace/audit/propose, query.
- Boundary inputs: CLI args, `HARNESS_HOME`, project `--dir`, filesystem.
- Validation: unit for domain; integration for FS/registry/index; e2e CLI;
  platform for Windows paths.

## Default Layering

```text
domain
  <- application
      <- infrastructure
          <- interface (CLI [, HTTP dashboard])
```

| Layer | May depend on | Must not depend on |
| --- | --- | --- |
| domain | pure utilities only | filesystem, process env, DB drivers |
| application | domain | commander, concrete path layout details when avoidable |
| infrastructure | application, domain | CLI parsing frameworks |
| interface | all lower layers | — |

## Mutation policy

Operational durable entities are written **only** through application services
invoked by CLI or MCP. Agents must not hand-edit entity markdown. Policy docs
(`HARNESS.md`, etc.) remain human-editable.

**Agent hard-fail (decision 0017):** CLI/MCP failure is non-skippable for
durable writes. Agents stop, recover via `doctor` / `link` / `reindex`, and
retry — never hand-edit entities to work around a tool error. Shipped wording
lives in the `templates/AGENTS.md` harness block.

**Auto-reindex (US-015):** Every mutation command (intake, story add/update,
decision add, backlog add/close, and report add/update) auto-reindexes the
project that owns the successful write. Agents never need to call
`harness reindex` manually after a mutation. The shared helper
`src/commands/_reindex-helper.ts` encapsulates this pattern.

## Upgrade system (US-016)

The harness version is tracked inside the `<!-- HARNESS:BEGIN/END -->` block
of AGENTS.md via a `<!-- harness-version: X.Y.Z -->` marker. When a repo was
initialized with an older CLI version, `harness upgrade` detects the mismatch
and replaces only the harness-managed block with the current template content.

```text
CLI (v0.9.7)
    |
    +-- harness upgrade
         |
         +-- read AGENTS.md → extract version marker
         +-- compare with VERSION
         +-- if older: backup AGENTS.md
         +-- replace HARNESS:BEGIN/END block from templates/AGENTS.md
         +-- auto-reindex
```

Key properties:
- Only the `<!-- HARNESS:BEGIN -->` ... `<!-- HARNESS:END -->` section is modified
- User-customized content outside the block is preserved
- Project Link role/stack/peer markers are preserved and its conditional
  `HARNESS:PROJECT-LINK:BEGIN/END` agent workflow is regenerated when configured
- Timestamped backup written to `.5harness-backup/` before modification
- Backward compatible: any old version can be upgraded to current
- Pre-0.9.7 repos (no version marker) receive guidance to re-init

See [decision 0013](../decisions/0013-harness-development-conventions.md) for
development conventions.

## This repo vs target projects

| | This product repo | Target repos after `init` |
| --- | --- | --- |
| Purpose | Build the CLI | Consume the CLI |
| Story packets | Yes — track product work | Yes — track their app work |

## Tracking

Implement order and story IDs: **`docs/product/roadmap.md`**.
