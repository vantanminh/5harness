# E06 — Global registry and project link

## Goal

Machine-local project registry under `~/.harness` (or `HARNESS_HOME`) so a
global CLI install can discover many harnessed projects. Enable the collaborator
workflow: **clone → link → use history**.

## Product docs

- `docs/product/global-registry.md`
- `docs/product/roadmap.md`
- Decision 0011

## Stories

| ID | Title | Status |
| --- | --- | --- |
| US-006 | Global registry + link/unlink/projects | planned |

## Exit criteria

- `harness link` registers a path; `projects` lists it; `unlink` removes entry.
- Missing paths are detectable (stale entry warning).
- Docs + tests cover registry location and override via env.
