# Spec: Project Link (peer projects + cross-project reports)

**Status:** planned (declaration only — no implementation in this task)  
**Intake:** IN-019  
**Decision:** 0022-project-peer-link-and-cross-project-reports  
**Stories:** US-059 … US-063  
**Depends on:** decision 0011 (markdown SoT + registry), 0017 (hard-fail), 0020 (project id + MCP binding)

---

## 1. Problem

Full-stack work often splits into **two or more Git repos** (e.g. backend API +
frontend web), each harnessed with `5harness`. Today:

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
| Role | `<!-- harness-project-role: frontend -->` | Yes | Tiny, always in agent entrypoint |
| Stack (optional) | `<!-- harness-project-stack: supabase -->` or comma list | Yes | Only when set |
| Peer edges | `<!-- harness-peer: id=<id>;role=<role> -->` (one marker per peer) | Yes | Clone recovers *intent*; machine still needs registry path |
| Path resolution | `~/.5harness/registry.json` id → absolute path | No | Same machine as today |
| Peer index | Peer’s `.5harness/index/` (rebuild with reindex/link) | No | Derived |
| Reports | Markdown entities under `docs/reports/` in **target** project | Yes | Backend history of FE findings travels with BE repo |
| Outbound stubs (optional) | Reporter project may keep a thin pointer entity or only the report id | Prefer **target-owned** SoT; reporter re-queries peer |

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

CLI **should** also write the reverse marker on the backend (`role=frontend`)
when the backend path is writable. If reverse write fails, forward link still
succeeds with a clear warning (partial link). Agents treat one-way links as
valid for reads toward the declared peer.

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
| No peers configured | Do **not** advertise peer/report tools (or advertise only `harness_project_peers` returning empty + setup hint). Prefer **dynamic list** to reduce agent confusion. |
| Peers configured | Expose peer read + report tools; each tool requires grant-scoped project bind (0020) for the **local** project; peer resolution uses registry under the same trust model (local machine). |

MCP names (illustrative):

- `harness_project_role` (get)
- `harness_project_peers` (list)
- `harness_peer_search` / `harness_peer_get` / `harness_peer_context` / `harness_peer_links`
- `harness_report_add` / `harness_report_list` / `harness_report_get` / `harness_report_update`

All-mode OAuth still requires `X-Harness-Project` for the **calling** project;
peer tools never treat peer id as the OAuth project selector.

### 4.6 Security / trust

- Peer reads: only via explicitly configured peer ids; path from registry; fail closed.
- Peer **writes** in v1: **only** create/update `report` entities on the target
  project root — not stories/decisions/intakes/backlog of the peer.
- Report bodies must not encourage secrets (tokens, passwords); tools should
  document “sanitize payloads”.
- Cross-project write is a **capability boundary**: document in SECURITY.md when
  implemented; doctor may warn if peer path is outside expected roots later
  (optional hardening — backlog).

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
- Stack: optional short tokens `[a-z0-9_-]+`, comma-separated, max small N (e.g. 4).

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
  --context "FE story US-12; repro with user demo@…" \
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
peer get/list.

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
fix code + tests; harness story update …; harness report update --status fixed --resolution …
git commit / push backend
    ▼
[FE agent] harness peer get RP-### --role backend
    │ reads fixed + resolution
    ▼
continue FE implementation with correct contract
```

### 5.6 Doctor / status / next (minimal v1)

- `doctor`: warn if peer markers exist but peer id unresolved on this machine;
  warn if peer path missing index (suggest reindex on peer).
- `status`: include `role`, `stack`, peer count, open report count (local target).
- `next`: if role is backend and open reports > 0, prefer surfacing open reports
  before random planned stories (soft recommendation).

---

## 6. CLI contract (target surface)

| Command | Behavior |
| --- | --- |
| `harness project role set <role> [--stack <tags>]` | Write role/stack markers |
| `harness project role show [--json]` | Print role/stack |
| `harness project peer add <id\|path> [--role <role>]` | Add peer edge (+ reverse when possible) |
| `harness project peer remove <id>` | Remove peer edge |
| `harness project peer list [--json]` | List peers + resolution |
| `harness peer search <query> [--role\|--peer]` | Search peer catalog |
| `harness peer get <id> [--role\|--peer] [--summary]` | Get peer entity |
| `harness peer context <id> [--role\|--peer] [--max-chars]` | Budgeted peer context |
| `harness peer links <id> [--role\|--peer]` | Peer link graph slice |
| `harness report add --to <role\|id> --summary …` | Create report on target |
| `harness report list [--status] [--json]` | List local (target) reports |
| `harness report get <id> [--from <role\|id>]` | Get local or via peer |
| `harness report update --id … --status … [--resolution]` | Lifecycle update on target |

Registry `harness link` / `unlink` / `projects` **unchanged**.

---

## 7. Implementation notes (for later coding)

1. Reuse `executeSearch` / `executeGet` / `executeContext` / `executeLinks` with
   injected `projectRoot` = peer root — do not fork ranking logic.
2. Extend `ENTITY_TYPES` with `report` + `docs/reports` + catalog/index paths.
3. Marker parse/emit lives next to `domain/project-id.ts` / upgrade pipeline;
   `upgrade` **must preserve** unknown harness markers it does not own, or
   explicitly re-emit role/stack/peer markers.
4. MCP: build tool list from local project config after bind (dynamic).
5. Tests: unit marker parse; integration two temp projects peer search + report
   round-trip; e2e CLI; MCP list presence with/without peers.
6. Docs: product README row; cli-contract; SECURITY note; AGENTS template
   conditional section; roadmap Phase **I / E16**.

---

## 8. Story map

| ID | Title | Lane | Depends |
| --- | --- | --- | --- |
| US-059 | Project role + optional stack markers + CLI | normal | 0020 |
| US-060 | Peer add/remove/list + reverse edge + registry resolve | normal | US-059 |
| US-061 | Peer read tools CLI + MCP (search/get/context/links) | high-risk | US-060, US-009, US-027 |
| US-062 | Report entity + add/list/get/update + cross-project write | high-risk | US-060 |
| US-063 | AGENTS workflow copy, doctor/status/next hooks, product docs finish | normal | US-061, US-062 |

---

## 9. Acceptance (initiative)

- Two harnessed temp projects can be peered; FE can search BE docs without
  copying files.
- FE can file RP report into BE; BE lists/fixes/resolves; FE sees `fixed` +
  resolution via peer get.
- Init without peers remains identical UX.
- Registry `harness link` meaning unchanged.
- Token tools return snippets/budgets only.
- Hard-fail (0017) applies to all new tools.
