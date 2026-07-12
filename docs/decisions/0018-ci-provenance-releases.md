---
id: 0018
type: decision
title: CI multi-OS matrix + npm trusted publishing provenance for releases
status: accepted
doc: docs/decisions/0018-ci-provenance-releases.md
verify: null
notes: "Accepted 2026-07-12. US-035: multi-OS/Node CI matrix. US-036: GitHub Releases + npm trusted publishing provenance. Links: IN-005"
created_at: "2026-07-12T06:05:32.078Z"
updated_at: "2026-07-12T06:05:32.078Z"
links:
  - IN-005
---

# CI multi-OS matrix + npm trusted publishing provenance for releases

Date: 2026-07-12

## Status

Accepted (CI matrix shipped in US-035; provenance/GitHub Releases tracked in US-036)

## Context

Production hardening (IN-005) requires confidence that the TypeScript CLI works on
the platforms agents and humans use: Linux, Windows, and macOS, on supported Node
engines (`>=22.5.0`). Release quality also needs signed/provenance-backed npm
publishes and GitHub Releases (US-036).

## Decision

### 1. CI matrix (US-035)

| Dimension | Values |
| --- | --- |
| OS | `ubuntu-latest`, `windows-latest`, `macos-latest` |
| Node | `22.x`, `24.x` |
| Command | `npm ci` then `npm run release:check` (typecheck + full tests + pack:check) |

- `fail-fast: false` so one OS/Node failure does not hide others.
- Auto-release / publish jobs remain **Ubuntu + Node 24 only** after the matrix is green.
- **Flake policy:** do not paper over flakes with blanket retries. Investigate and
  fix or quarantine with a tracked story. Matrix isolation helps attribute OS-specific failures.

### 2. Provenance and GitHub Releases (US-036)

Tracked separately: npm trusted publishing (OIDC) + provenance attestations,
GitHub Releases on tag, reduce reliance on long-lived `NPM_TOKEN` where possible.

## Consequences

- PR CI runs six build-test cells (3 OS × 2 Node).
- Windows path and CRLF issues surface in CI rather than only on contributor machines.
- Slightly higher Actions minutes; justified for a global CLI.

## Links

- IN-005 — production hardening wave
- US-035 — multi-OS multi-Node CI matrix
- US-036 — production releases + provenance
