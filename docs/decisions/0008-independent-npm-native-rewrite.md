# 0008 Independent npm-Native Rewrite

Date: 2026-07-10

## Status

Accepted

## Context

The parent workspace contains both:

- `repository-harness/` — upstream project (Rust CLI, curl/ps1 installer,
  repo-local `scripts/bin/harness-cli`)
- `harness/` — intended home for a **new product**

We need a durable product identity: this repo is not a packaging wrapper around
upstream forever, and not a line-by-line fork. Users should install and run with
npm (`harness init`, etc.). Engine language (TypeScript vs Rust behind npm) may
still be chosen later, but distribution and ownership must be clear now.

## Decision

1. **`harness/` is an independent rewrite** of the agent-repository harness
   concept, with its own product docs, decisions, CLI contract, and code.
2. **Primary distribution is npm** with a `harness` CLI bin. Preferred consumer
   install is project-local (`devDependency` + `npx`).
3. **v0 ships** init + durable core commands + operating file templates — not
   full upstream Phase/Symphony parity.
4. **End users must not** be required to run `.ps1`/curl installers or manually
   manage platform binaries for normal use.
5. A **native (e.g. Rust) engine is allowed** later if shipped as prebuilt
   artifacts resolved by the npm package; users still only run npm/npx.

## Alternatives Considered

1. **npm wrapper only around upstream binaries** — Rejected as the long-term
   product: keeps upstream release/tag coupling and weak ownership.
2. **Pure fork of upstream tree** — Rejected: confuses identity; carries
   installer and paths we intentionally replace.
3. **TypeScript-only forever** — Deferred: allowed for MVP, not mandated by
   this decision.
4. **Require Rust toolchain on user machines** — Rejected for end-user UX.

## Consequences

Positive:

- Clear product ownership and docs path for agents.
- UX aligns with Node ecosystems (`npx harness ...`).
- Room to use Rust later without changing the user-facing install story.

Tradeoffs:

- Node.js becomes a prerequisite to *install/run* the harness tool even for
  non-Node target repos.
- Temporary bootstrap still uses upstream `harness-cli` inside this repo until
  the product CLI exists.
- Exact CLI flag parity with upstream is not promised in v0.

## Follow-Up

- Choose npm package name/scope.
- Scaffold package + implement `harness init` and durable MVP commands.
- Replace bootstrap `scripts/bin/harness-cli` usage in docs once product CLI
  works.
- Engine decision (TS vs Rust core) when the first implementation story starts,
  if not already obvious from contributor preference.
