# Harness

Operate this repository through the **5harness** CLI (`harness`). Durable
stories, decisions, intakes, backlog items, and reports are Git-backed
markdown. **Do not hand-edit those files.**

## Before work

```bash
harness doctor --json
harness status --json
harness next --json
```

Read with tools, not whole-tree dumps:

```bash
harness search "…" --json
harness get <id> --json
harness links <id> --json
harness context <id> --json
harness query matrix --json
harness query reports --json
```

## Intake and mutation

```bash
harness intake --type <type> --summary "…" --lane tiny|normal|high-risk
harness story add --id US-… --title "…" --lane normal
harness story start US-…
harness story update --id US-… --status implemented --unit 1 --integration 1 --e2e 0 --platform 0
harness decision add --id … --title "…" --doc docs/decisions/….md
harness decision update --id … --status accepted --notes "…"
harness backlog add --title "…" --pain "…"
```

## Hard-fail (decision 0017)

If a harness command exits non-zero: **stop**. Recover with `harness doctor`,
`harness link`, `harness reindex`. Never bypass by editing entity markdown.

## MCP

Discover the project id with `harness project id`. For all-projects OAuth
grants send `X-Harness-Project: <id>` on every call. Prefer MCP JSON tools
(`harness_next`, `harness_get`, `harness_query_*`) over shell when MCP is
connected.

Do not call unimplemented commands such as `score-context` or
`intervention add` (decision 0023).
