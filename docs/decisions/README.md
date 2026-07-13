# Decisions

Decision records explain why important product, architecture, or harness choices
were made.

Use `docs/templates/decision.md` when adding a new decision.

After adding or updating a markdown decision file, also add or refresh the
durable decision row:

```bash
npm run harness -- decision add \
  --id 0011-global-tool-markdown-durable-index \
  --title "Global tool markdown durable index" \
  --doc docs/decisions/0011-global-tool-markdown-durable-index.md
```

Trace fields such as `--decisions` summarize task-level choices. They do not
count as the Harness decision log.

## Index (product-critical)

| ID | Title | Status |
| --- | --- | --- |
| 0004 | SQLite durable layer | **Superseded** by 0011 for SoT |
| 0005 | Prebuilt native engine | **Superseded** by 0010 / 0008 |
| 0008 | npm-native product distribution | Accepted |
| 0009 | Standalone product repository | Accepted |
| 0010 | TypeScript CLI toolchain | Accepted |
| **0011** | **Global tool, markdown durable, agent index** | **Accepted** (active pivot) |
| **0019** | **Embedded OAuth 2.1 and PKCE boundary for MCP** | **Accepted** |

Add a decision when:

- A locked technical choice changes.
- A product rule changes meaningfully.
- A validation requirement is added, removed, or weakened.
- A high-risk feature chooses one design over another.
- Auth, authorization, data ownership, audit/security, or API behavior changes.
- The source-of-truth hierarchy changes.

Implementation tracking for 0011: `docs/product/roadmap.md`.
