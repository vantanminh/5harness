# Improvement Protocol

Phase 5 starts the self-improvement loop:

```text
friction + interventions + audit findings
  -> harness-cli propose
  -> proposed backlog item
  -> human review
  -> implementation with predicted impact
  -> close with actual outcome
```

## Generate Proposals

```bash
harness propose
```

The command is rule-based. It looks for:

- repeated trace friction,
- repeated intervention patterns,
- non-zero audit categories.

Each proposal includes title, component, evidence, predicted impact, risk,
suggested action, validation plan, and confidence.

## Commit Proposals

```bash
harness propose --commit
```

Committed proposals become `proposed` backlog items. Humans review them with:

```bash
harness query backlog --open
```

## Review Rules

- Tiny proposals may be implemented directly when they only clarify docs.
- Normal proposals need a story packet or clear backlog acceptance.
- High-risk proposals need a durable decision record before changing source
  hierarchy, architecture direction, validation requirements, or risk policy.
- Completed proposal work must close the backlog item with actual outcome
  evidence.

## Validation

After implementation, compare the predicted impact with:

- `harness audit`,
- `harness query friction`,
- `harness query interventions`,
- benchmark trace quality and harness compliance when benchmark proof applies.
