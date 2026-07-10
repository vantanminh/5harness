# Stories

Stories are work packets. They turn product intent into bounded implementation
and validation work.

## Active Epics

| Epic | Focus | Stories |
| --- | --- | --- |
| [E01-npm-cli-foundation](./epics/E01-npm-cli-foundation/README.md) | Phase A: npm package + `harness init` | US-001 implemented |
| [E02-durable-mvp](./epics/E02-durable-mvp/README.md) | Phase B: durable commands | US-002 implemented |
| [E03-quality](./epics/E03-quality/README.md) | Phase C: verify / trace / audit | US-003 implemented |

## Story Index

| ID | Title | Lane | Status | Path |
| --- | --- | --- | --- | --- |
| US-001 | Scaffold npm package and `harness init` | normal | implemented | [epics/E01-…/US-001-…](./epics/E01-npm-cli-foundation/US-001-scaffold-package-and-harness-init.md) |
| US-002 | Durable commands on harness CLI | normal | implemented | [epics/E02-…/US-002-…](./epics/E02-durable-mvp/US-002-durable-commands.md) |
| US-003 | Phase C quality commands | normal | implemented | [epics/E03-…/US-003-…](./epics/E03-quality/US-003-quality-commands.md) |

## Normal Story

Use `docs/templates/story.md` for normal feature work.

Suggested path:

```text
docs/stories/epics/E01-domain-name/US-001-short-story-title.md
```

## High-Risk Story

Use `docs/templates/high-risk-story/` when the feature intake classifies work as
high-risk.

Suggested path:

```text
docs/stories/epics/E02-risky-domain/US-012-risky-story-title/
  execplan.md
  overview.md
  design.md
  validation.md
```

## Status Flow

```text
planned -> in_progress -> implemented
                  |
                  v
               changed
                  |
                  v
               retired
```
