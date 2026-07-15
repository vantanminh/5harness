# Spec: Project Link (peer projects + cross-project reports)

**Status:** implemented (unreleased)
**Intake:** IN-019  
**Decision:** 0022-project-peer-link-and-cross-project-reports  
**Stories:** US-059 … US-063, US-068
**Depends on:** decision 0011 (markdown SoT + registry), 0017 (hard-fail), 0020 (project id + MCP binding)

---

## 1. Problem

Full-stack work often splits into **two or more Git repos** (e.g. backend API +
frontend web), each harnessed with `5harness`. Before Project Link:

1. An agent in the **frontend** repo cannot safely search backend product docs /
   stories / decisions without the human pasting files or opening the other repo.
2. When the frontend agent discovers an **API contract mismatch** (wrong fields,
   missing keys, unexpected shape), there is no durable, tool-driven channel to
   file that finding for the **backend** agent.
3. The backend agent has no standard “check what frontend reported” entrypoint;
   the frontend agent has no standard way to see **fixed / context after fix**.
4. Agents lack a compact signal of **what this project is** (frontend vs backend
   vs BaaS-backed frontend) comparable to today’s `harness-project-id` marker.

Existing `harness link` only means **register this clone on the machine
registry** (`~/.5harness`). It must **not** be overloaded for repo-to-repo
peering (name collision + different semantics).

---

## 2. Goals

| # | Goal |
| --- | --- |
| G1 | Opt-in **project peer** links between harnessed projects on the same machine, without changing default `init` for users who never need it. |
| G2 | Persist **project role** (and optional **stack** tags such as `firebase` / `supabase`) in the AGENTS.md harness block so agents do not guess. |
| G3 | Frontend (or any peer) agents can **search / get / context** durable docs of a peer project with the same **token discipline** as local tools (snippets, budgets — no vault dumps). |
| G4 | Agents can file a compact **cross-project report** (API mismatch, contract bug, missing field) into the target peer’s durable store with concrete context. |
| G5 | Target-project agents can list open reports, fix product code, and **resolve** with status + resolution notes; reporter-side agents can re-check status. |
| G6 | Full **CLI + MCP** surface for the above; AGENTS.md managed block updated only when the feature is used. |
| G7 | Prefer **few, role-aware tools** and dynamic MCP exposure so agents are not flooded with peer tools when no peers exist. |

### Non-goals (v1)

- Cloud multi-tenant peer registry (still deferred — BL-003).
- Automatic discovery of peers by git remote alone (explicit user/agent link).
- Full remote mutation of peer **stories / decisions / intakes** (only the
  report/inbox channel is a cross-project write surface in v1).
- Vector RAG across projects.
- Replacing Git as the collaboration channel for durable history.
- Renaming or changing semantics of registry command `harness link`.

---

## 3. Vocabulary (locked)

| Term | Meaning |
| --- | --- |
| **Registry link** | `harness link` — register a project path in `~/.5harness` (existing). |
| **Project peer / Project Link feature** | Explicit relationship between two harness project ids for agent cross-read and reports. |
| **Role** | What this repo is in the product system: `frontend`, `backend`, `mobile`, `service`, `shared`, `other`. |
| **Stack** | Optional tags for implementation surface: e.g. `firebase`, `supabase`, `custom` (free short token list). |
| **Report** | Durable cross-project note about a contract/runtime issue; lives primarily in the **target** project. |
| **Peer tools** | Read tools that run against a peer’s index/root after path resolution. |

CLI product name for humans: **Project Link**.  
CLI command namespace (to avoid clashing with registry `link`):

```text
harness project role …
harness project peer …
harness peer …
harness report …
```

---

## 4. Architecture (smart defaults)

### 4.1 Where state lives

| State | Storage | Git | Why |
| --- | --- | --- | --- |
| Project id | `<!-- harness-project-id: … -->` in AGENTS harness block | Yes | Already shipped (0020) |
| Role | `<!-- harness-project-role: frontend -->` | Yes | Tiny once configured; visible in the agent entrypoint |
| Stack (optional) | `<!-- harness-project-stack: supabase -->` or comma list | Yes | Only when set |
| Peer edges | `<!-- harness-peer: id=<id>;role=<role> -->` (one marker per peer) | Yes | Clone recovers *intent*; machine still needs registry path |
| Path resolution | `~/.5harness/registry.json` id → absolute path | No | Same machine as today |
| Peer index | Peer’s `.5harness/index/` (rebuild with reindex/link) | No | Derived |
| Reports | Markdown entities under `docs/reports/` in **target** project | Yes | Backend history of FE findings travels with BE repo |
| Reporter copy | None | — | Reporter re-queries the configured target; no duplicate report file |

**Design choice (locked):** peer *identity* is git-tracked; peer *filesystem path*
is machine-local via registry. After clone on a new machine: `harness link` each
repo, then peers resolve again if both are registered. No cloud required.

**Design choice (locked):** do **not** invent a fifth high-churn entity type for
the peer graph itself — markers in the managed AGENTS block keep token cost low
and match project-id UX. Reports **are** a new entity type because they are
operational work items with lifecycle.

### 4.2 Resolution algorithm

```text
peer tools / report write
  → read local peer markers (or --peer / --role selector)
  → resolve peer project_id → path via registry
  → if missing path / missing disk / not harnessed → fail closed (exit 1 / MCP error)
  → never fall back to “first linked project” or cwd guess
```

Selector priority for peer tools:

1. Explicit `--peer <project-id>` / MCP `peer_id`
2. Explicit `--role <role>` when **exactly one** peer has that role
3. Error if ambiguous or none

### 4.3 Bidirectional edges

When both projects are on disk and registered:

```bash
# from frontend
harness project peer add <backend-id-or-path> --role backend
```

CLI also attempts to write the reverse marker on the backend
(`role=frontend`) when the backend path is writable. If the reverse write
fails, the forward link remains saved and the command prints a clear partial
link warning. Agents treat one-way links as valid for reads toward the declared
peer. Removal likewise removes the local marker first and attempts the reverse
unlink.

### 4.4 Token discipline

| Tool | Returns | Budget |
| --- | --- | --- |
| `peer search` | Ranked id, type, path, score, **snippet** | Same as local `search` |
| `peer get` | One entity; optional `--summary` frontmatter only | Bounded |
| `peer context` | Budgeted pack (`maxChars`) | Same as local `context` |
| `peer links` | Out/back titles only | Bounded |
| `report list` | id, status, severity, summary, updated_at | No full body |
| `report get` | Full report entity | One entity |

**No** recursive peer-of-peer. **No** dumping peer `docs/` trees.

### 4.5 MCP surface

| Mode | Tools |
| --- | --- |
| No peers configured | Advertise `harness_project_role` and `harness_project_peers`, but do **not** advertise peer-read or report tools. |
| Peers configured | Also advertise peer read + report tools. The OAuth grant binds the **calling** project; configured markers and the same-machine registry resolve peer capabilities. |

Implemented MCP names:

- `harness_project_role` (get)
- `harness_project_peers` (list)
- `harness_peer_search` / `harness_peer_get` / `harness_peer_context` / `harness_peer_links`
- `harness_report_add` / `harness_report_list` / `harness_report_get` / `harness_report_update`

For an all-projects OAuth grant, `X-Harness-Project` or `?project=` always
selects the **calling** project. `peer_id`, `role`, `to`, and `from` only select
a configured capability from that calling project; they never replace the
OAuth project selector or authorize an arbitrary project. Single-project grants
remain forced to the project chosen at consent.

### 4.6 Security / trust

- Peer reads: only via explicitly configured peer ids; path from the
  same-machine registry; fail closed.
- After explicit peer-management configuration (which may write a reverse
  AGENTS marker), cross-project **operational-entity writes** in v1 only create
  `report` entities on the target project root — never stories, decisions,
  intakes, backlog, or existing reports.
- Cross-project creation is limited to target-owned reports. Lifecycle updates
  run only in the calling/local project, so a peer cannot remotely resolve a
  target report.
- Optional `HARNESS_PEER_WRITE_ROOTS` hardens report creation on shared
  machines. Its value is a platform-path-delimited list of existing absolute
  directories (`;` on Windows, `:` on macOS/Linux). CLI and MCP canonicalize
  the target path and fail closed if the configuration is invalid or no root
  contains the target. Unset preserves the explicit-configured-peer v1 trust
  model; peer reads are unaffected.
- Report bodies must be sanitized: never include credentials, tokens, secrets,
  or unnecessary personal data.
- Successful report mutations reindex the project that owns the changed report.

---

## 5. Product behavior

### 5.1 Role and stack (opt-in)

```bash
harness project role set frontend --stack supabase
harness project role show
harness project role show --json
```

- `init` does **not** require role/stack.
- Markers written only when set/changed.
- `harness upgrade` preserves existing role/stack/peer markers (must not strip).
- Valid roles: `frontend` | `backend` | `mobile` | `service` | `shared` | `other`.
- Stack: optional lowercase tokens `[a-z0-9_-]+`, comma-separated, at most four
  tags and 32 characters per tag; duplicates are rejected.

AGENTS managed block example after configuration:

```html
<!-- HARNESS:BEGIN -->
<!-- harness-version: X.Y.Z -->
<!-- harness-project-id: a1b2… -->
<!-- harness-project-role: frontend -->
<!-- harness-project-stack: supabase -->
<!-- harness-peer: id=be9f…;role=backend -->
## Harness
…
<!-- HARNESS:END -->
```

Agent-facing short rules (injected only when role/peers present):

- If role is `frontend`: prefer peer tools for API/backend contract docs; file
  reports toward `backend` instead of inventing backend schemas.
- If role is `backend`: on start of “fix FE issues” work, run `harness report list --status open` before coding.

The role/peer commands maintain a conditional
`HARNESS:PROJECT-LINK:BEGIN/END` workflow section inside the Harness-managed
block. Plain `harness init` output has no Project Link workflow copy. Setting a
role or peer adds it, role changes refresh it, removing the final peer removes
it when no role is set, and `harness upgrade` preserves the markers while
regenerating the current copy.

### 5.2 Peer management

```bash
harness project peer add <project-id-or-path> [--role <peer-role>]
harness project peer remove <project-id>
harness project peer list
harness project peer list --json
```

Rules:

- Target must be a harnessed project with a durable project id.
- Prefer id over path in committed markers (stable across machines).
- Path form is accepted as input and resolved to id before write.
- `peer list` shows id, role, resolved path (or `unresolved`), name.

### 5.3 Peer reads

```bash
harness peer search "auth session" --role backend
harness peer get US-014 --role backend
harness peer get US-014 --peer <id> --summary
harness peer context API-auth --role backend --max-chars 4000
harness peer links DEC-010 --role backend
```

Semantics mirror local tools but `projectRoot` is the peer root.

### 5.4 Reports (cross-project work channel)

**Entity type:** `report`  
**Path:** `docs/reports/<id>.md`  
**Id form:** auto `RP-001`… (or caller-supplied `RP-…`)

Frontmatter (minimum):

| Field | Notes |
| --- | --- |
| `id` | `RP-###` |
| `type` | `report` |
| `status` | `open` \| `acked` \| `fixed` \| `wontfix` \| `needs_info` |
| `severity` | `low` \| `medium` \| `high` |
| `summary` | one line |
| `from_project_id` | reporter |
| `from_role` | optional |
| `to_project_id` | target (this project when stored on target) |
| `api` | optional route/RPC name |
| `expected` | optional short |
| `actual` | optional short |
| `context` | free text / structured notes (keep short) |
| `resolution` | filled on fix |
| `related` | optional story/decision ids on target |
| `created_at` / `updated_at` | ISO |

Commands:

```bash
# from frontend (writes into backend project)
harness report add \
  --to backend \
  --summary "Login response missing refresh_token" \
  --api "POST /v1/auth/login" \
  --expected "refresh_token:string" \
  --actual "only access_token present" \
  --context "FE story US-12; reproduced with the auth fixture" \
  --severity high

# on backend
harness report list --status open
harness report get RP-001
harness report update --id RP-001 --status acked
harness report update --id RP-001 --status fixed \
  --resolution "Added refresh_token to AuthResponse; see US-088"

# from frontend after fix
harness report get RP-001 --from backend   # peer read of report entity
# or
harness peer get RP-001 --role backend
```

**SoT rule:** the canonical report file lives in the **target** project
(`to_project_id`). Reporter does not need a second full copy; status is read via
`harness report get --from` or `harness peer get`. `report add` validates both
durable project ids and writes only to a configured peer. `report list`, local
`report get`, and `report update`
operate on the calling project. `fixed` requires a non-empty resolution.

### 5.5 Enterprise-like agent flow (canonical)

```text
[FE agent] implements against API
    │ discovers field mismatch
    ▼
harness report add --to backend --summary … --api … --expected … --actual …
    │  (writes docs/reports/RP-###.md in backend repo)
    ▼
[Human / BE agent session] "Check frontend reports and fix"
    ▼
harness report list --status open
harness report get RP-###
    ▼
fix code + tests; harness story update …; harness report update --id RP-### --status fixed --resolution …
git commit / push backend
    ▼
[FE agent] harness peer get RP-### --role backend
    │ reads fixed + resolution
    ▼
continue FE implementation with correct contract
```

### 5.6 Doctor / status / next (minimal v1)

- `doctor`: warns if peer markers cannot resolve through this machine's registry,
  when a resolved peer has no readable index, or when a resolved report target
  is outside `HARNESS_PEER_WRITE_ROOTS`. Invalid policy syntax is also reported;
  report creation itself fails closed. These are non-fatal health warnings with
  recovery guidance.
- `status`: includes role, stack, configured peer count, and the count of local
  reports whose status is `open`, in both human and JSON output.
- `next`: for a backend role, orders open reports after in-progress stories and
  before planned stories. Other roles retain the existing ordering.

---

## 6. CLI contract (implemented surface)

| Command | Behavior |
| --- | --- |
| `harness project role set <role> [--stack <tags>]` | Write role/stack markers |
| `harness project role show [--json]` | Print role/stack |
| `harness project peer add <id\|path> [--role <role>]` | Add peer edge (+ reverse when possible) |
| `harness project peer remove <id>` | Remove peer edge |
| `harness project peer list [--json]` | List peers + resolution |
| `harness peer search <query> (--role <role>\|--peer <id>)` | Search peer catalog |
| `harness peer get <id> (--role <role>\|--peer <id>) [--summary]` | Get peer entity |
| `harness peer context <id> (--role <role>\|--peer <id>) [--max-chars]` | Budgeted peer context |
| `harness peer links <id> (--role <role>\|--peer <id>)` | Peer link graph slice |
| `harness report add --to <role\|id> --summary …` | Create report on target |
| `harness report list [--status] [--json]` | List local (target) reports |
| `harness report get <id> [--from <role\|id>]` | Get local or via peer |
| `harness report update --id … --status … [--resolution]` | Lifecycle update on target |

Registry `harness link` / `unlink` / `projects` **unchanged**.

---

## 7. Implementation notes

1. Peer reads reuse the local search/get/context/links application paths with
   an explicitly resolved peer root, preserving ranking and token budgets.
2. `report` is a catalog/index entity under `docs/reports/`; report mutations
   use the normal lock and reindex path.
3. Role, stack, and peer marker parsing/emission lives beside durable project
   identity, and the upgrade pipeline preserves those markers while refreshing
   conditional workflow copy.
4. MCP builds its tool list after the OAuth-bound calling project is known, so
   peer/report tools appear only when that project has configured peers.
5. Unit, integration, CLI e2e, MCP, OAuth, and platform-path tests cover marker
   round trips, two-project reads, report lifecycle, dynamic tools, and denial
   of unconfigured or incorrectly bound projects.

---

## 8. Story map

| ID | Title | Lane | Status | Depends |
| --- | --- | --- | --- | --- |
| US-059 | Project role + optional stack markers + CLI | normal | implemented | 0020 |
| US-060 | Peer add/remove/list + reverse edge + registry resolve | normal | implemented | US-059 |
| US-061 | Peer read tools CLI + MCP (search/get/context/links) | high-risk | implemented | US-060, US-009, US-027 |
| US-062 | Report entity + add/list/get/update + cross-project write | high-risk | implemented | US-060 |
| US-063 | AGENTS workflow copy, doctor/status/next hooks, product docs finish | normal | implemented (unreleased) | US-061, US-062 |
| US-068 | Optional report target root allowlist + doctor diagnostics | normal | implemented | US-062 |

---

## 9. Acceptance (initiative)

- [x] Two harnessed temp projects can be peered; FE can search BE docs without
  copying files.
- [x] FE can file RP report into BE; BE lists/fixes/resolves; FE sees `fixed` +
  resolution via peer get.
- [x] Init without peers remains identical UX.
- [x] Registry `harness link` meaning unchanged.
- [x] Token tools return snippets/budgets only.
- [x] Hard-fail (0017) applies to all new tools.
