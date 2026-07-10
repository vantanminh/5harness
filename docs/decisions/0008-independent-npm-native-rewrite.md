# 0008 npm-Native Product Distribution

Date: 2026-07-10

## Status

Accepted

## Context

This product needs a clear install story: agents and humans should get a single
`harness` CLI via npm, without platform-specific installer scripts or manual
binary placement as the primary path.

## Decision

1. **This repo is the product** — own product docs, decisions, CLI contract, and
   implementation live here.
2. **Primary distribution is npm** with a `harness` CLI bin. Preferred consumer
   install is global (`npm i -g @vantanminh/harness`).
3. **End users must not** be required to run shell installers or manually
   manage platform binaries for normal use.
4. A **native engine is allowed** later if shipped as prebuilt artifacts
   resolved by the npm package; users still only run npm/npx.

## Alternatives Considered

1. **Repo-local binary installers as the long-term contract** — Rejected for
   multi-project UX and Node ecosystem fit.
2. **Require a systems language toolchain on user machines** — Rejected for
   end-user UX.
3. **TypeScript-only forever** — Deferred: allowed for MVP, not mandated.

## Consequences

Positive:

- Clear product ownership and docs path for agents.
- UX aligns with Node ecosystems (`npm i -g` / `npx harness ...`).
- Room for a native engine later without changing the install story.

Tradeoffs:

- Node.js becomes a prerequisite to install/run the harness tool even for
  non-Node target repos.

## Follow-Up

- Package identity: `@vantanminh/harness` (done).
- Ship init + durable commands + operating templates (done through v0.9).
