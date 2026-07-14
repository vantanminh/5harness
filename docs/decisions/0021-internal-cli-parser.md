---
id: 0021
type: decision
title: Replace commander dependency with in-house CLI parser
status: accepted
doc: docs/decisions/0021-internal-cli-parser.md
verify: null
notes: null
created_at: "2026-07-13T09:35:19.252Z"
updated_at: "2026-07-13T09:35:19.252Z"
links: ["IN-014", "US-056", "US-057", "US-058"]
---

# Replace commander dependency with in-house CLI parser

Date: 2026-07-13

## Status

Accepted

## Context

The project currently lists **commander v14** as its sole runtime dependency in
`package.json`. Commander provides CLI parsing for the `harness` binary surface.
While commander is mature and well-tested, having zero external runtime
dependencies is a stronger supply-chain posture for an agent-facing tool.

**Commander API surface used** (audited from `src/cli.ts`, ~830 lines):

| API | Usage |
| --- | --- |
| `new Command()` | Root program |
| `.name()`, `.description()`, `.version()` | Metadata |
| `.command("name")` | Subcommand (returns new Command, nesting supported) |
| `.argument("<required>")`, `.argument("[optional]")` | Positional args |
| `.option("-s, --long <val>", "desc")`, `.option("--flag", "desc", "default")` | Named options |
| `.requiredOption("--long <val>", "desc")` | Required options |
| `.action(fn)` | Arity-based dispatch (positional args → opts object) |
| `.hook("preAction", async fn)` | Pre-action hook |
| `.parseAsync(args)` | Async parse + execute |
| Implicit `--help` generation | Help text with usage, options, subcommands |

**Not used:** `.addOption()`, `.passThroughOptions()`, `.enablePositionalOptions()`,
`.allowExcessArguments()`, `.addHelpCommand()`, `.addHelpText()`,
`.configureOutput()`, `.showHelpAfterError()`, `.exitOverride()`,
`.storeOptionsAsProperties()`.

The surface is modest: ~10 methods, no Option class, no custom help
configuration, no pass-through or excess-args modes.

## Decision

1. **Build an in-house CLI parser** at `src/infrastructure/cli-parser.ts`
   implementing the exact subset of Commander's API that this project uses.

2. **Layer placement:** The parser lives in `infrastructure` (per architecture
   doc: "infrastructure may depend on application, domain; CLI parsing
   frameworks go here").

3. **Wire it in `src/cli.ts`** by swapping the import, with zero changes to
   command handler logic.

4. **Remove the `commander` npm dependency** from `package.json` after
   integration passes the full test suite.

5. **Breaking this into 3 stories:**
   - **US-056:** Options, arguments, help generation
   - **US-057:** Subcommand nesting, action dispatch, hooks
   - **US-058:** Integration + remove commander

6. **Compatibility contract:** The replacement must produce identical behavior
   for all existing CLI commands. `--help` output format may differ in
   whitespace/capitalization but must convey the same information. Exit codes
   must match (0 success, 1 error).

## Alternatives Considered

1. **Keep commander** — simplest, but leaves an external dependency for a
   modest API surface. Tax on `npm i -g` install time and audit surface.

2. **Use Node `util.parseArgs`** — built-in since Node 18.3, but does not
   support subcommand nesting or action-based dispatch. Would require building
   routing on top anyway.

3. **yargs / minimist / etc.** — still external dependencies, no advantage
   over commander for this surface.

## Consequences

**Positive:**
- Zero runtime dependencies in `package.json`
- Full control over CLI parsing behavior and error messages
- Smaller install footprint (`npm i -g` faster, no node_modules tree)
- Reduced supply-chain audit surface

**Tradeoffs:**
- ~200-400 lines of new code to maintain
- Must match commander behavior for edge cases (help output, error formatting)
- Architecture doc must be updated to reflect internal parser
- Decision 0010 (TypeScript CLI toolchain) reference to commander superseded

