# Harness

The harness is the repo-level operating system for humans and coding agents.

The app is what users touch. The harness is what agents touch.

## Mental Model

```text
Human intent
  -> Feature intake (tiny | normal | high-risk)
  -> Story packet (when needed)
  -> Agent work loop
  -> Product delta + proof
  -> Harness delta (docs, decisions, backlog)
```

Every task may produce:

1. **Product delta** — application code, tests, product docs.
2. **Harness delta** — operating docs, templates, decisions that help the next agent.

## Durable Layer

Operational records live in local SQLite (`harness.db`, gitignored), managed by
the `harness` CLI installed via npm. Policy docs in `docs/` stay human-readable.

```bash
npx harness init      # once per project
npx harness migrate   # apply schema updates
```

Additional durable commands (intake, story, query, …) arrive in later package
versions.
