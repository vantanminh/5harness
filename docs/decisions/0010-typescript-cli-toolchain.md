# 0010 TypeScript CLI Toolchain (Phase A)

Date: 2026-07-10

## Status

Accepted

## Context

US-001 needs a shippable npm CLI quickly. Decision 0008 allows TypeScript and/or
Rust behind the npm bin. We need a concrete Phase A stack without delaying
`harness init`.

## Decision

1. Implement the Phase A CLI in **TypeScript** (ESM, NodeNext).
2. CLI parsing: **commander**.
3. SQLite: Node built-in **`node:sqlite`** (`DatabaseSync`) — no native addon.
4. Tests: **vitest**; local run via **tsx**; build via **tsc** to `dist/`.
5. Package name on npm: **`npm-harness`** with bin name **`harness`**.
6. Require **Node >= 22.5** (for `node:sqlite`).

## Alternatives Considered

1. **better-sqlite3** — mature, but adds native compile surface for installers.
2. **Rust core + npm wrapper for Phase A** — higher CI/release cost; deferred.
3. **Package name `harness`** — likely contested on the public registry; use
   `npm-harness` for now.

## Consequences

Positive:

- Fast iteration and simple Windows install for contributors.
- Zero node-gyp dependency for end users.

Tradeoffs:

- `node:sqlite` is still experimental in Node; may need driver swap later.
- Node 22.5+ floor excludes older LTS without upgrade.

## Follow-Up

- Revisit Rust engine when durable command surface or performance needs justify
  multi-platform native publishes.
- Confirm package name before first public publish if scope/`@org` is preferred.
