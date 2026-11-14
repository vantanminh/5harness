---
created_at: "2026-11-14T04:21:49.046822400+00:00"
doc: docs/decisions/0028-workspace-mode-orchestration.md
id: 0028-workspace-mode-orchestration
links:
  - IN-040
  - 0011-global-tool-markdown-durable-index
  - 0017-agent-hard-fail-contract
  - 0020-mcp-project-binding-at-authorization
  - 0022-project-peer-link-and-cross-project-reports
notes: "Evaluated 3 options: (1) Extend Project Link AGENTS markers inside child repos (rejected: cannot anchor uninitialized non-git parent dir, mutates all child AGENTS.md, risks 1.0 Project Link freeze); (2) Standalone workspace store disconnected from Project Link (rejected: duplicates role/report concepts); (3) Selected: Workspace orchestration layer (harness workspace) anchored at parent dir, stored in versioned HARNESS_HOME/workspaces.json (no silent files in user workspace) with optional portable manifest, reusing global registry, Project Link roles/reports, and per-project derived indexes. Worktrees deduplicated via git-common-dir; impact gating combines declared dependencies, story contract metadata, and advisory diff hints."
status: accepted
title: Workspace mode orchestration layer over registry and Project Link
type: decision
updated_at: "2026-11-14T04:21:49.046824700+00:00"
verify: null
---

# Workspace mode orchestration layer over registry and Project Link
