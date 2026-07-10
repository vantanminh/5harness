# 0009 Upstream Is Reference Only

Date: 2026-07-10

## Status

Accepted

## Context

Both repos sit in one workspace:

```text
npm-harness/
  repository-harness/   # upstream
  harness/              # this product
```

Agents need an explicit rule so they:

- know upstream exists and is useful
- do not implement features in the wrong tree
- do not treat upstream docs as this product's source of truth
- do not bulk-copy or rebrand upstream content as ours without intent

## Decision

1. **`../repository-harness` is a read-only reference** for agents working in
   this repo (unless the human explicitly requests upstream edits).
2. **All product implementation and harness deltas for this product** land in
   `harness/` only.
3. **Source of truth** for this product is:
   - `AGENTS.md`
   - `README.md`
   - `docs/product/*`
   - `docs/decisions/*` in this repo
4. When designing or implementing behavior that should align with known harness
   semantics, agents **should consult** upstream entry points listed in
   `AGENTS.md` **after** reading this repo's product docs.
5. **Copy policy:** re-implement; do not mass-copy source, installers, or
   upstream README branding. Schema/command ideas may be adapted with new
   ownership and docs.

## Alternatives Considered

1. **Ignore upstream entirely** — Rejected: wastes a high-quality behavioral
   reference already present in the workspace.
2. **Git submodule / vendored upstream** — Rejected for v0: blurs ownership and
   invites accidental coupling.
3. **Monorepo merge of both trees as one product** — Rejected: conflicts with
   independent rewrite decision (`0008`).

## Consequences

Positive:

- Agents can navigate the workspace without confusing the two products.
- Design discussions can cite upstream paths concretely.
- Legal/identity clarity: we are not silently republishing upstream as our app.

Tradeoffs:

- Agents must keep two trees straight (mitigated by `AGENTS.md`).
- Reference may drift as upstream evolves; we pin understanding via our own
  decisions and stories, not live upstream HEAD.

## Follow-Up

- Keep `AGENTS.md` workspace layout section current if folder names change.
- If upstream is deleted from the workspace, update this decision and AGENTS
  with a remote URL reference instead of a relative path.
