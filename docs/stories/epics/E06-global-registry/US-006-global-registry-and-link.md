# US-006 Global registry and link

## Status

planned

## Lane

normal

## Product Contract

A machine-local global registry tracks harnessed project paths. Users can
`link`, `unlink`, and list `projects`. This enables multi-project discovery and
the clone collaborator workflow without cloud sync.

## Relevant Product Docs

- `docs/product/global-registry.md`
- `docs/product/cli-contract.md`
- `docs/product/roadmap.md`
- `docs/decisions/0011-global-tool-markdown-durable-index.md`

## Acceptance Criteria

- Default registry root is `~/.harness` (Windows: user profile home); override
  with `HARNESS_HOME`.
- `harness link [path]` registers project root (default cwd); idempotent update
  if already linked.
- `harness unlink [path]` removes registry entry only (does not delete project).
- `harness projects` lists linked projects (path, name, linked_at; optional remote).
- Missing project path is marked or warned when listing.
- Registry file is JSON (or equivalent) and safe for concurrent simple updates
  (document file-lock or atomic write approach).
- Unit + CLI e2e tests with temp `HARNESS_HOME`.
- Product docs and CHANGELOG note the commands.

## Design Notes

- Commands: `link`, `unlink`, `projects`
- Storage: `HARNESS_HOME/registry.json` (illustrative)
- Domain: pure register/unregister helpers; infrastructure owns FS paths
- Do **not** store story/decision bodies in the registry
- `init` auto-link can wait for US-010; this story may add a shared `registerProject()` API used later

## Validation

| Layer | Expected proof |
| --- | --- |
| Unit | registry add/remove/idempotent |
| Integration | FS write under temp HARNESS_HOME |
| E2E | CLI link → projects → unlink |
| Platform | Windows path + home resolution |
| Release | pack still valid; version bump when shipped |

## Harness Delta

- New infrastructure module for global home/registry
- CLI contract Phase F commands

## Evidence

_(fill when implemented)_
