# Stories

Stories are work packets. They turn product intent into bounded implementation
and validation work.

**Implementation tracking map:** [`docs/product/roadmap.md`](../product/roadmap.md)

## Active Epics

| Epic | Focus | Stories |
| --- | --- | --- |
| [E01-npm-cli-foundation](./epics/E01-npm-cli-foundation/README.md) | Phase A: npm package + `harness init` | US-001 **implemented** |
| [E02-durable-mvp](./epics/E02-durable-mvp/README.md) | Phase B: durable commands (SQLite MVP) | US-002 **implemented** |
| [E03-quality](./epics/E03-quality/README.md) | Phase C: verify / trace / audit | US-003 **implemented** |
| [E04-release-hardening](./epics/E04-release-hardening/README.md) | Phase D: release hardening | US-004 **implemented** |
| [E05-evolution](./epics/E05-evolution/README.md) | Phase E: propose + tools | US-005 **implemented** |
| [E06-global-registry](./epics/E06-global-registry/README.md) | Phase F1: global registry + link | US-006 **implemented** |
| [E07-markdown-store](./epics/E07-markdown-store/README.md) | Phase F2: markdown durable SoT | US-007 **implemented**; US-008 planned |
| [E08-agent-index](./epics/E08-agent-index/README.md) | Phase F3: get/search/links | US-009 planned |
| [E09-init-link-pivot](./epics/E09-init-link-pivot/README.md) | Phase F4: init + templates pivot | US-010–011 planned |
| [E10-quality-on-md](./epics/E10-quality-on-md/README.md) | Phase F5: quality + SQLite retire | US-012–013 planned |
| [E11-dashboard](./epics/E11-dashboard/README.md) | Phase G: local dashboard | US-014 planned |

## Story Index

| ID | Title | Lane | Status | Path |
| --- | --- | --- | --- | --- |
| US-001 | Scaffold npm package and `harness init` | normal | implemented | [E01](./epics/E01-npm-cli-foundation/US-001-scaffold-package-and-harness-init.md) |
| US-002 | Durable commands on harness CLI | normal | implemented | [E02](./epics/E02-durable-mvp/US-002-durable-commands.md) |
| US-003 | Phase C quality commands | normal | implemented | [E03](./epics/E03-quality/US-003-quality-commands.md) |
| US-004 | Phase D release hardening | normal | implemented | [E04](./epics/E04-release-hardening/US-004-release-hardening.md) |
| US-005 | Propose + tool registry | normal | implemented | [E05](./epics/E05-evolution/US-005-propose-and-tools.md) |
| US-006 | Global registry + link/unlink/projects | normal | implemented | [E06](./epics/E06-global-registry/US-006-global-registry-and-link.md) |
| US-007 | Markdown entity writes | normal | implemented | [E07](./epics/E07-markdown-store/US-007-markdown-entity-writes.md) |
| US-008 | Markdown query reads | normal | planned | [E07](./epics/E07-markdown-store/US-008-markdown-query-reads.md) |
| US-009 | reindex / get / search / links | normal | planned | [E08](./epics/E08-agent-index/US-009-reindex-get-search-links.md) |
| US-010 | Init payload + registration | normal | planned | [E09](./epics/E09-init-link-pivot/US-010-init-payload-and-registration.md) |
| US-011 | Target templates + agent policy | tiny | planned | [E09](./epics/E09-init-link-pivot/US-011-target-templates-agent-policy.md) |
| US-012 | Quality on markdown store | normal | planned | [E10](./epics/E10-quality-on-md/US-012-quality-on-markdown-store.md) |
| US-013 | SQLite retirement + import | normal | planned | [E10](./epics/E10-quality-on-md/US-013-sqlite-retirement-and-import.md) |
| US-014 | Dashboard foundation | normal | planned | [E11](./epics/E11-dashboard/US-014-dashboard-foundation.md) |

## Recommended implement order

```text
US-006 → US-007 → US-008 → US-009 → US-010 → US-011 → US-012 → US-013 → US-014
```

See dependency notes in `docs/product/roadmap.md`.

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

## Templates

- Normal: `docs/templates/story.md`
- High-risk: `docs/templates/high-risk-story/`
