# CLI Contract

User-facing bin name: `harness`.

Install (**preferred** — decision 0011):

```bash
npm i -g 5harness
harness <command>
```

Alternate: `npm i -D 5harness` + `npx harness <command>`.

Package name: **`5harness`**. Bin name: **`harness`**.

## Commands in scope for Phase A (US-001) — shipped MVP

| Command | Behavior |
| --- | --- |
| `harness --version` / `-V` | Print CLI version from package |
| `harness --help` / `-h` | Top-level help |
| `harness update` | Install the npm `latest` dist-tag globally; normal commands recheck that tag hourly and retry failed checks after five minutes |
| `harness init [options]` | Scaffold operating files + (MVP: SQLite; **target 0011:** markdown + registry) |
| `harness migrate` | MVP only: apply SQL migrations (retired when markdown SoT ships) |

## `harness init` options (Phase A)

| Option | Meaning |
| --- | --- |
| `[directory]` or `--dir <path>` | Target project root (default: cwd) |
| `--yes` / `-y` | Non-interactive; do not prompt |
| `--dry-run` | Print planned writes; write nothing |
| `--force` | Overwrite conflicting non-protected files after backup (define precisely in story) |

Merge/override policy for existing `AGENTS.md` / `docs/` may be a follow-up story if Phase A only supports empty or non-conflicting targets. **Phase A minimum:** refuse to clobber protected paths unless `--force`, with a clear error.

## Commands in scope for Phase B (US-002)

| Command | Behavior |
| --- | --- |
| `harness intake` | Record feature intake (`--type`, `--summary`, `--lane`, …) |
| `harness story add` | Add a story matrix row |
| `harness story update` | Update status, proof flags (`0\|1`), evidence, verify command |
| `harness decision add` | Add a decision row |
| `harness backlog add` | Add a backlog item |
| `harness backlog close` | Close backlog (`implemented` / `rejected`) |
| `harness query matrix` | Story matrix (`--numeric` for 0/1) |
| `harness query stats` | Summary counts |
| `harness query intakes` | Recent intakes |
| `harness query decisions` | Decisions |
| `harness query stories` | Story list |
| `harness query backlog` | Backlog (`--open` / `--closed`) |

Most durable commands accept `-d, --dir <path>` for the target project (default: cwd).
They auto-migrate an existing DB; if the DB is missing, run `harness init` first.

## Commands in scope for Phase C (US-003)

| Command | Behavior |
| --- | --- |
| `harness story verify <id>` | Run story `verify_command`; record pass/fail |
| `harness story verify-all` | Verify all stories with a command |
| `harness decision verify <id>` | Run decision verify command |
| `harness trace` | Record execution trace (`--summary`, `--outcome`, …); scores by default |
| `harness score-trace [--id]` | Score latest or specific trace tiers |
| `harness query traces` | List recent traces |
| `harness audit` | Drift findings + entropy score 0–100 |

## Commands in scope for Phase E (US-005)

| Command | Behavior |
| --- | --- |
| `harness propose` | Print improvement proposals from audit findings |
| `harness propose --commit` | Also insert new proposals into backlog (dedupe open titles) |
| `harness query tools` | Built-in tool registry (`--capability`, `--status`) |

## Commands in scope for Phase F (0011 store pivot)

| Command | Behavior |
| --- | --- |
| `harness init` | Scaffold markdown + **register** project in global registry |
| `harness link [path]` | Register existing harness project (clone workflow) + reindex |
| `harness unlink [path]` | Drop registry entry only |
| `harness projects` | List linked projects |
| `harness reindex` | Rebuild derived index from markdown |
| `harness get <id\|path>` | Load one entity (optional summary) |
| `harness search <query>` | Ranked hits with snippets |
| `harness links <id>` | Outbound + backlinks |

Write commands (`intake`, `story`, `decision`, `backlog`) keep the same *intent*
but persist to markdown entities. Agents **must** use these tools; they must not
hand-edit operational markdown.

## Commands in scope for Phase H (E12–E14, post-G agent loop)

### E12 — Agent Loop Tier 1

| Command | Behavior |
| --- | --- |
| `harness doctor [--fix] [--json]` | Workspace health checks (harness install, store, reindex, git, node) |
| `harness status [--json]` | Project snapshot: stories, intakes, backlog, version, index age |
| `harness next [--json]` | Recommend next work item (in_progress → planned → intake → backlog) |
| `harness context <id> [--depth 0\|1] [--max-chars N] [--json]` | Budgeted entity context pack |
| `harness tool register [--name] [--command] ...` | Register external project tool |
| `harness tool check [--name] [--json]` | Scan registered tools |
| `harness tool remove [--name] [--json]` | Remove a registered tool |

### E13 — Agent Loop Tier 2

| Command | Behavior |
| --- | --- |
| `harness story start --id <id>` | Mark story as in_progress |
| `harness story done --id <id>` | Mark story as implemented |
| `harness story block --id <id> [--reason]` | Mark story as blocked |
| `harness worklog add --story <id> --summary <text> [--pr] [--commit]` | Add worklog entry |
| `harness worklog list [--json]` | List worklog entries |
| `harness worklog from-git --story <id> [--since]` | Link recent git commits to a story |
| `harness intake-run [--prompt]` | Analyze prompt and suggest intake classification |
| `harness dashboard` | Start local dashboard (supports mutations via same CLI code paths) |

### E14 — Agent Loop Tier 3

| Command | Behavior |
| --- | --- |
| `harness mcp` | Start an **unbound** OAuth 2.1 + PKCE protected MCP server. Cwd and `--dir` do not authorize project tools; calls fail closed until OAuth authorization supplies a project binding. RFC 9728/RFC 8414 discovery, dynamic public-client registration, resource-bound Bearer tokens. **Read tools:** get, search, links, context, status, query matrix/stats, handoff, doctor, reindex. **Mutation tools (US-041):** intake, story_add/update, decision_add, backlog_add. Non-loopback requires `--public-url https://...`. |
| `harness export changelog [--since <tag\|date>] [--json]` | Derive changelog notes from implemented stories/decisions (assist only) |
| `harness watch` | Watch entity directories and auto-reindex on markdown changes (debounced 500ms) |
| `harness handoff [--story <id>] [--json]` | Emit concise session summary: recent traces, worklog, status, next steps |

## Commands deferred (later)

Custom tool registration, changesets, score-context, cloud registry.

## Exit codes

Aligned with [decision 0017](../decisions/0017-agent-hard-fail-contract.md)
(agent hard-fail contract):

| Code | Meaning | Agent expectation |
| --- | --- | --- |
| 0 | Success | Continue |
| 1 | Usage / validation / operational error | **HARD STOP** for the failed step; run recovery (`doctor`, `link`, `reindex`) then retry. Never hand-edit durable entities as a fallback. |
| 2 | Reserved (optional: partial success / soft fail) | Treat as non-success unless the specific command documents otherwise |

`harness doctor` exits non-zero only for hard-fail modes; soft issues are
warnings with exit 0 (US-018).

## Environment

| Variable | Meaning |
| --- | --- |
| `HARNESS_HOME` | Override global harness dir (default `~/.5harness`) |
| `HARNESS_DB_PATH` | **Legacy only** — path to SQLite DB for `import-sqlite` / old DB ops |
| `HARNESS_DEBUG` | When `1`/`true`, emit debug lines to stderr and append to the log file |
| `HARNESS_LOG_FILE` | Override log file path (default: project `.5harness/logs/5harness.log` when a project context exists, else `$HARNESS_HOME/logs/5harness.log`) |
| `HARNESS_JSON_ERRORS` | When `1`/`true`, print failures as a single JSON object on stderr (`ok`, `code`, `message`, `exitCode`) |

## Structured errors (US-033)

CLI failures go through a shared `fail()` path:

| Field | Meaning |
| --- | --- |
| `code` | Stable `HARNESS_E_*` identifier (`USAGE`, `VALIDATION`, `NOT_FOUND`, `STATE`, `IO`, `INTERNAL`) |
| `message` | Human-readable explanation (no secrets) |
| `exitCode` | Process exit code (usually `1`) |

Human stderr form:

```text
error: HARNESS_E_NOT_FOUND: Entity not found: US-999
```

JSON form (`HARNESS_JSON_ERRORS=1`):

```json
{"ok":false,"code":"HARNESS_E_NOT_FOUND","message":"Entity not found: US-999","exitCode":1}
```

Logs never intentionally write secrets (tokens, API keys, passwords are redacted).
`harness doctor` reports the active log file path under the `logs` check.

## Index integrity (US-034)

| Mechanism | Behavior |
| --- | --- |
| Atomic write | `index.json` written via temp file + rename |
| Mutation lock | `.5harness/mutation.lock` held during index write; stale locks reclaimed after ~30s |
| Checksum | SHA-256 over stable index payload; stored as `checksum` on the index |
| Recovery | `harness reindex` rebuilds a valid index; never hand-edit `index.json` |

`harness doctor` includes an `index-integrity` check (corrupt JSON, schema mismatch,
checksum failure, missing entity files → fail; unresolved links / missing checksum → warn).
