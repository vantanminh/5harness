# Docs Tools — AI Agent Reference

The `harness docs` command group lets agents browse and search the harness
package's own documentation. Use these tools to understand how harness works,
its CLI contract, architecture, context rules, and conventions — without
reading raw files from disk.

## When to Use

- You are an AI agent operating in a harness-equipped repo and need to
  understand harness behavior, CLI commands, or conventions.
- You need to find a specific topic, option, or convention across harness docs.
- You want to see what documentation files are available before reading one.

**Do NOT use `harness docs` to read target-project entities** (stories,
decisions, intakes, backlog, reports). Use `harness get`, `harness search`,
`harness query`, or the bounded `harness peer` equivalents for that.

## Commands

### `harness docs search <query>`

Search all markdown files under the harness package's `docs/` directory for
matching text. Returns snippets (max 3 per file) with context (±2 lines).

```
harness docs search "init command"
harness docs search "story add"
harness docs search "context rules"
```

Output is markdown-formatted:

```
# Docs Search Results (2 files)
## HARNESS.md
> # Harness
```
harness init
harness intake  --type <type> --summary <text> --lane <lane>
```
...
```

**Token discipline:** The search returns snippets, not full file bodies.
After finding relevant files, use `harness docs read <path>` to read the full
content of the files you need.

### `harness docs list`

List all available documentation files with their first-heading titles.

```
harness docs list
```

Output is a table:

```
path                    title
HARNESS.md              Harness
ARCHITECTURE.md         Architecture
TOOL_REGISTRY.md        Tool Registry
product/overview.md     Product Overview
...
```

Use this to discover what docs exist before deciding what to read.

### `harness docs read <path>`

Read a full documentation file. The path is relative to `docs/`.

```
harness docs read HARNESS.md
harness docs read ARCHITECTURE.md
harness docs read product/cli-contract.md
```

Output is the complete markdown content of the file, prefixed with the
relative path as a heading.

## Key Documentation Files

| File | When to Read |
| --- | --- |
| `HARNESS.md` | Understanding harness mental model, commands, mutation policy |
| `ARCHITECTURE.md` | Layer structure, upgrade system, mutation policy |
| `TOOL_REGISTRY.md` | Built-in tools, inbound tool registration |
| `CONTEXT_RULES.md` | Phase-based reading guidance, risk-lane context budgets |
| `FEATURE_INTAKE.md` | Intake classification, risk lanes |
| `product/overview.md` | Product one-liner, problem/solution, surfaces |
| `product/cli-contract.md` | CLI surface contract, every command and its args |
| `product/roadmap.md` | Implementation phases and story tracking |
| `product/agent-index.md` | Agent retrieval API (get/search/links/reindex) |
| `product/project-link.md` | Roles, configured peers, bounded peer reads, reports |
| `TRACE_SPEC.md` | Trace recording expectations |
| `TEST_MATRIX.md` | Testing expectations by risk lane |
| `GLOSSARY.md` | Terminology |
| `decisions/*.md` | Durable architecture/product decisions |

## Typical Agent Workflow

1. **Discover what docs exist:** `harness docs list`
2. **Search for a topic:** `harness docs search "verify command"`
3. **Read the relevant file(s):** `harness docs read HARNESS.md`
4. **Follow references:** Some docs link to decisions or other files — use
   `harness docs read` to follow those.

## Relationship to Other Commands

| Command | Searches |
| --- | --- |
| `harness search <q>` | Local target-project **entities**, including reports |
| `harness peer search <q>` | One explicitly configured peer's entities; bounded snippets |
| `harness docs search <q>` | Harness package **documentation** (how harness works) |
| `harness get <id>` | One target-project entity by ID |
| `harness docs read <path>` | One harness documentation file by path |
| `harness query matrix` | Target-project story matrix |
| `harness query tools` | All built-in and registered tools |

## Error Handling

- `docs search` with empty query → error message.
- `docs read` on missing file → error with hint to use `docs list`.
- `docs read` on path outside `docs/` → error (directory-traversal blocked).

## Implementation Notes

- Documentation is read from the **installed package root** (alongside
  `templates/` and `migrations/`), not from the current working directory.
- All files are read synchronously — suitable for CLI invocation.
- Search is case-insensitive, snippet-based (not vector/FTS).
