# US-005 Propose and tool registry

## Status

implemented

## Lane

normal

## Product Contract

Agents can list equipped harness tools via `query tools` and generate advisory
improvement proposals from audit findings via `propose` (optionally commit to
backlog).

## Acceptance Criteria

- `harness query tools` lists built-in commands with capability tags.
- `harness propose` prints proposals derived from current audit findings.
- `harness propose --commit` inserts proposals into backlog (dedupe by title when open item exists).
- Empty audit yields a clear “no proposals” message.
- Tests cover tools listing and propose/commit round-trip.
- Docs/changelog updated; version 0.5.0.

## Evidence

```text
npm test
npm run pack:check
```
