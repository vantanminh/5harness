# Spec: MCP project binding at authorization

**Status:** implemented
**Intake:** IN-012  
**Decision:** 0020-mcp-project-binding-at-authorization  
**Stories:** US-050 … US-054  
**Supersedes (behavior):** implicit cwd/`--dir` bind on `harness mcp`; dashboard
MCP cwd/first-linked fallback without grant-time selection.

---

## 1. Problem

Today:

1. `harness mcp` binds tools to `cwd` or `--dir` at process start
   (`createMonitoredMcpHandler(targetDir)`).
2. Dashboard `POST /mcp` resolves project per request via
   `?project` / `X-Harness-Project` / cwd match / first linked project
   (`resolveMcpProjectRoot`) — **not** at OAuth consent.
3. OAuth access tokens carry only scope `mcp:access` (decision 0019); they have
   **no project grant claim**.
4. Registry project `id` is a path-hash (`sha256(path)[:16]`), not a stable
   agent-facing id inside the repo. Agents cannot reliably discover “this
   workspace’s project id” without registry knowledge.

Result: multi-project machines are ambiguous; agents may read/write the wrong
project; consent does not express least-privilege project scope.

---

## 2. Goals

| # | Goal |
| --- | --- |
| G1 | Starting `harness` (default dashboard) or `harness mcp` does **not** bind tool execution to a project from cwd. |
| G2 | Human **authorization / consent** for an MCP client selects project scope: **one project** or **all linked projects**. |
| G3 | After a single-project grant, every MCP tool call runs **only** against that project. |
| G4 | After an all-projects grant, the agent **must** supply the target project id on each MCP call; missing/unknown id fails closed. |
| G5 | Each harnessed repo has a **random durable project id** stored in local `AGENTS.md` (harness-managed block). |
| G6 | Agents discover the id by reading `AGENTS.md` or running `harness project id` (from that project directory). |

### Non-goals (this initiative)

- Cloud multi-tenant auth or remote project registry.
- Changing durable SoT away from project markdown (decision 0011).
- Replacing OAuth 2.1 + PKCE (decision 0019); this **extends** grants.
- Making every CLI mutation command require project id (shell CLI remains
  cwd/`--dir` project-scoped as today).

---

## 3. Product behavior

### 3.1 Durable project identity

- On `harness init` and `harness link` (and upgrade/reindex ensure path): if the
  project lacks a project id marker, generate a **cryptographically random**
  opaque id (recommended: 16–32 lowercase hex or URL-safe chars; not path-derived).
- Persist inside the harness-managed section of `AGENTS.md`, e.g.:

  ```html
  <!-- harness-project-id: a1b2c3d4e5f67890 -->
  ```

  Next to existing `<!-- harness-version: X.Y.Z -->`. Marker is managed by
  harness (init / link / upgrade / `project id --ensure`); agents must not invent ids.
- CLI:

  | Command | Behavior |
  | --- | --- |
  | `harness project id` | Print the project id for cwd/`--dir`. Exit 0. |
  | `harness project id --json` | `{ "id", "path", "name?" }` |
  | `harness project id --ensure` | Create marker if missing, then print. |

- Registry (`~/.5harness/registry.json`): store/sync the same id on the project
  entry so dashboard/OAuth can list and resolve path ↔ id. Migration: existing
  path-hash registry ids are **replaced or dual-mapped** when the AGENTS.md id
  is first seen (see decision 0020 — prefer **AGENTS.md id as canonical** once
  present; keep path as location).

### 3.2 Unbound server start

```text
harness              # dashboard + hosted MCP: no default project bind
harness mcp          # standalone MCP: no cwd/--dir tool bind
```

- Process starts: HTTP + OAuth discovery + login/authorize surfaces only.
- Tool dispatch **before** a valid grant with resolvable project scope returns a
  clear error (not silent cwd fallback).
- Optional `--dir` on `harness mcp` may still set **display cwd / default link
  hint** but must **not** auto-bind tools without consent (breaking change vs
  v0.16).

### 3.3 Authorization UI (consent)

On `/authorize` after human login (same trust model as 0019: cookie only for
Approve/Deny, never for MCP Bearer):

1. List **healthy linked** projects (id, name, path).
2. Human selects **exactly one** of:
   - **Single project** — radio/select one project id.
   - **All linked projects** — grant mode `all`.
3. Approve issues an access token whose grant includes:

   ```json
   {
     "scope": "mcp:access",
     "project_mode": "single" | "all",
     "project_ids": ["…"]   // length 1 when single; empty or omitted when all
   }
   ```

4. Deny / cancel: no token (existing behavior).

### 3.4 MCP call routing after grant

| Grant mode | Project selection | Failure mode |
| --- | --- | --- |
| `single` | Forced to granted project id → path | Ignore conflicting client project hints **or** reject if client supplies a different id (prefer **reject** for explicit mistakes). |
| `all` | Client **must** pass project id | Missing / unknown / unlinked / missing-on-disk → JSON-RPC or HTTP error; no cwd fallback. |

**How the agent passes project id (all mode):**

1. Primary: HTTP header `X-Harness-Project: <id>` (already partially used on dashboard).
2. Alternate: query `?project=<id>` on `POST /mcp`.
3. Optional later: tool argument `project_id` on every tool — **not required** if
   header is mandatory for all-mode clients; document one canonical path for agents.

**Agent discovery procedure (document in AGENTS template):**

```bash
# from the repo the agent is working in
harness project id
# or read <!-- harness-project-id: … --> from AGENTS.md
```

Then configure MCP client / each call with that id when the OAuth grant is `all`.

### 3.5 Monitoring and audit

- Extend MCP call records with `project_id` and `project_mode` (in addition to
  `project_root`).
- Dashboard monitor filters by project id.

### 3.6 Security notes

- Least privilege: default consent should encourage **single project**, not all.
- `all` is powerful (any linked project on the machine); approval page must
  label risk clearly.
- Tokens remain machine-local, opaque, audience-bound (0019).
- Project id is **not a secret** (it lives in Git-tracked AGENTS.md); authorization
  is still the OAuth token + grant mode.

---

## 4. Architecture sketch

```text
Agent workspace (repo)
  AGENTS.md  <!-- harness-project-id: XXX -->
       │
       │  harness project id  →  XXX
       ▼
MCP client ── Bearer token ──► harness mcp / dashboard /mcp
                                  │
                    validate token + grant
                                  │
              single ──────────────── all
                │                      │
                ▼                      ▼
         grant.project_ids[0]    require X-Harness-Project / ?project=
                │                      │
                └──────────┬───────────┘
                           ▼
                  registry: id → path
                           ▼
              handleMcpRequest(body, projectRoot)
```

**Code touchpoints (implementation later):**

| Area | Files (current) |
| --- | --- |
| MCP bind | `src/commands/mcp.ts`, `src/application/mcp-server.ts` |
| Dashboard MCP | `src/application/dashboard.ts` (`resolveMcpProjectRoot`) |
| OAuth grant | `src/application/mcp-oauth.ts`, `mcp-oauth-http.ts`, auth pages |
| Registry | `src/domain/registry.ts`, link/init |
| AGENTS markers | `src/domain/upgrade.ts`, `src/infrastructure/upgrade.ts`, templates |
| CLI | `src/cli.ts` — new `project` command group |
| Docs | `docs/SECURITY.md`, `docs/product/cli-contract.md`, `templates/AGENTS.md` |

---

## 5. Implementation plan (ordered)

### Phase A — Identity (US-050)

1. Define marker format + parse/emit helpers (domain, pure).
2. Generate id on init; ensure on link; `harness project id` / `--ensure` / `--json`.
3. Registry sync: store AGENTS.md id on linked entry; list shows id.
4. Tests: init/link/id stability; no hand-edit required for marker on upgrade merge.
5. Migrate note: existing clones get id on next `link` / `project id --ensure` / `upgrade`.

### Phase B — Unbound server (US-051)

1. Remove start-time `createMonitoredMcpHandler(targetDir)` implicit bind for tools.
2. MCP tools require resolved project root from grant context per request.
3. Health endpoint reports `project_bound: false` until grant used (or list modes).
4. Breaking: document in CHANGELOG / cli-contract.

### Phase C — Consent project picker (US-052)

1. Extend authorize HTML: project list + single vs all.
2. Persist grant claims on auth code → access token.
3. Token validation returns project_mode + project_ids.
4. Unit + HTTP tests for grant shapes.

### Phase D — Enforcement (US-053)

1. Wire `requireMcpBearer` → grant → resolve path → `handleMcpRequest`.
2. Single mode: always that root; reject mismatched client project id.
3. All mode: require header/query; resolve via registry; fail closed.
4. Monitor records include project_id.
5. E2E: two temp projects, single vs all grants, cross-project denial.

### Phase E — Docs & agent UX (US-054)

1. Update SECURITY.md, cli-contract, README MCP section, AGENTS template discovery steps.
2. Roadmap row for this initiative.
3. Soft-deprecate reliance on cwd MCP bind.

---

## 6. Acceptance criteria (initiative-level)

- [x] Fresh `harness mcp` without completed OAuth grant cannot mutate/read a project via tools.
- [x] Consent single-project: tools only see that project's entities.
- [x] Consent all-projects without `X-Harness-Project` fails closed.
- [x] Consent all-projects with correct id targets that project only for that call.
- [x] `harness project id` matches AGENTS.md marker and registry entry.
- [x] Existing OAuth PKCE / audience rules still hold (0019).
- [x] No durable entity hand-edits required; agents use CLI/MCP only.

---

## 7. Risks & open questions

| Risk / question | Recommendation |
| --- | --- |
| Breaking change for agents that relied on cwd-bound `harness mcp` | Document; optional transitional flag only if needed — default is unbound. |
| Registry path-hash ids vs new random ids | Canonical id in AGENTS.md; rewrite registry entry on ensure/link. |
| Should `all` include projects linked after token issue? | Prefer **snapshot at grant time** of linked ids, or re-resolve any currently linked id; decide in US-052 (recommend: any **currently linked healthy** id for operator flexibility). |
| Git merge conflicts on AGENTS.md project id | Rare; id should not change once set; never regenerate if present. |
| Dashboard-only vs standalone parity | Same grant model on both HTTP surfaces. |

---

## 8. Related entities

| Kind | Id |
| --- | --- |
| Intake | IN-012 |
| Decision | 0020-mcp-project-binding-at-authorization |
| Stories | US-050, US-051, US-052, US-053, US-054 |
| Prior art | US-027, US-041, US-045–048, 0015, 0019 |
