# Security notes (operational trust model)

Public reporting policy and supported versions:
**[SECURITY.md](../SECURITY.md)** (repository root — GitHub Security Policy).

This page documents how harness treats trust boundaries for operators, agents,
and CI. Implementation references point into `src/` where useful.

## Trust overview

| Surface | Trust class | Default exposure |
| --- | --- | --- |
| Durable markdown (stories, decisions, …) | Project Git authors | Repo contents |
| `harness` CLI mutations | Local operator / agent with shell | Local filesystem |
| `verify` frontmatter commands | Project-authored shell | Local cwd = project |
| Machine registry (`~/.5harness`) | Local user | Paths on this machine |
| Project Link peer reads | Explicit peer markers + local registry | Configured same-machine projects only |
| Project Link reports | Project Git authors + configured reporter peer | Target project's durable markdown |
| Dashboard | Loopback HTTP | `127.0.0.1` by default |
| MCP server | OAuth 2.1 protected resource | Loopback HTTP by default |
| npm update check | Public registry read | Advisory stderr only |
| npm publish / Releases | Maintainer CI (OIDC) | Provenance when configured |

**Do not** treat harness as a multi-tenant security boundary. Anyone who can
edit the project, run the CLI as your user, or reach a non-loopback bind can
affect local project state.

---

## Verify commands (`harness story verify` / `decision verify`)

Stories and decisions may set a `verify` frontmatter field: a **single-line shell
command** that the CLI runs with the project directory as `cwd`.

| Aspect | Detail |
| --- | --- |
| Source of the command | Local Git-backed markdown (project authors / collaborators) |
| Who triggers execution | Operator running `harness story verify …` (or verify-all) |
| Shell | Yes — so common proof scripts work (`npm test`, `node -e "…"`, `&&`) |
| Hardening | Non-empty, max length, no null bytes / newlines; cwd must be a real directory; timeout + maxBuffer |

This is the same trust class as:

- CI workflow `run:` steps
- `npm test` / Makefile targets checked into the repo

**Do not** treat `verify` as a place for remote or unauthenticated input. If an
attacker can change committed story files, they can already change app source
and CI scripts.

Implementation: `src/infrastructure/verify.ts`.

---

## MCP (Model Context Protocol)

| Aspect | Detail |
| --- | --- |
| Auth model | OAuth 2.1 Authorization Code with mandatory PKCE S256 |
| Default bind | `127.0.0.1` (see `harness mcp` / dashboard `--host`) |
| Discovery | RFC 9728 protected-resource metadata + RFC 8414 authorization-server metadata |
| Client model | Dynamic registration of public clients; no client secret |
| Tokens | Opaque, one-hour, in-memory, Bearer header only, bound to the canonical `/mcp` resource |
| Project grant | Consent selects one healthy linked project or all healthy linked projects |
| Project routing | Single grants force their selected project; all grants require `X-Harness-Project` or `?project=` on every call |
| Mutation surface | Reads and controlled durable mutations; agents still follow AGENTS hard-fail rules |
| Call log | `.5harness/local/mcp-calls.jsonl` under the project (machine-local) |
| Notification POSTs | `202 Accepted` with no body (Streamable HTTP; required by Codex CLI / rmcp) |
| JSON-RPC request POSTs | `200` + `application/json` response body |
| Human approval | Shared `/login` session only; `/authorize` never collects credentials |

Authorization codes are valid for five minutes and redeemable once. Redirect
URIs must match registration exactly and use HTTPS or a localhost loopback URI.
PKCE `plain`, implicit flow, password flow, query-string access tokens, and
cross-audience tokens are rejected. Dashboard cookies never authorize MCP calls;
they only prove the human operator may click Approve/Deny on `/authorize`.
Unauthenticated GET `/authorize` redirects to `/login?redirect=…` (path + query
preserved; open redirects rejected). The approval page's CSP permits form
navigation only to the server itself and the origin of that already validated,
registered callback; it never uses a wildcard callback destination.

MCP processes start without a project authorization derived from cwd, `--dir`,
or registry order. For a single-project grant, the server resolves only the id
selected at consent and rejects a conflicting request selector. For an
all-projects grant, every tool request must provide `X-Harness-Project: <id>` or
the compatibility query parameter `?project=<id>`. Missing or conflicting
selectors, unknown or unlinked ids, and projects missing on disk are rejected;
there is no cwd or first-linked fallback. Project ids are random durable routing
identifiers, not secrets or authentication credentials. Operators can inspect a
repo's id with `harness project id` or its `harness-project-id` marker in
`AGENTS.md`.

The administrator signs in once on the shared login page, then approves a client
in the browser. Set a non-default password with
`harness dashboard set-password` before authorizing clients. Client
registrations, pending codes, and access tokens are process-local; restarting the
server revokes them.

Plain HTTP is supported only for loopback native-client interoperability. A
non-loopback bind hard-fails unless `--public-url https://...` is supplied; that
mode assumes a correctly configured TLS reverse proxy and remains a single-user
operator boundary, not multi-tenant authorization.

Implementation: `src/application/mcp-oauth.ts`,
`src/application/mcp-oauth-http.ts`, `src/application/mcp-server.ts`, and
`src/application/dashboard.ts`. The complete request-routing contract is in
[`docs/product/mcp-project-binding.md`](product/mcp-project-binding.md).

---

## Project Link capability boundary

Project Link is an explicit same-machine trust relationship. Durable
`harness-peer` markers identify allowed project ids, while
`~/.5harness/registry.json` resolves those ids to local paths. A marker without
a healthy registry entry and matching durable id does not grant access: peer
reads and report creation fail closed. Peer markers are capability
configuration, not authentication. Paths supplied directly to peer-read/report
commands are not a capability, and peer-of-peer traversal is not supported.

| Operation | Allowed target | Mutation scope |
| --- | --- | --- |
| Peer search/get/context/links | One configured peer selected by id or an unambiguous role | Read-only, bounded index/entity output |
| Report add | One configured peer selected by id or role | Creates one target-owned `docs/reports/RP-###.md` entity and reindexes the target |
| Report list/get/update | Calling/local project; `get --from` may read one configured peer | Lifecycle updates are local only and reindex the owner |

`harness project peer add/remove` are explicit configuration commands and may
best-effort write reverse AGENTS markers. After that configuration step,
reports are the only cross-project operational-entity write surface and are
Git-backed entities in the **target** project. A reporter cannot remotely
mutate the target's stories, decisions, intakes,
backlog, or existing report lifecycle. Target agents acknowledge or resolve
reports locally; `fixed` requires resolution notes. Report summaries, context,
expected/actual values, and resolutions must be sanitized: never include
credentials, tokens, secrets, passwords, or unnecessary personal data.
Field-length validation is not secret detection or automatic redaction.

For MCP, OAuth continues to authorize the **calling** project. A single grant is
forced to its consent-selected project; an all-projects grant uses
`X-Harness-Project` or `?project=` to select the calling project on every
request. Tool arguments `peer_id`, `role`, `to`, and `from` only select a
configured capability from that root and never replace OAuth project routing.
`harness_project_role` and `harness_project_peers` remain visible after binding;
peer-read/report tools are not advertised when the calling project has no
configured peers. Dynamic hiding reduces tool noise; it is not the authorization
boundary. Selector and registry/id validation still fail closed. MCP call
monitoring remains under the calling project.

`harness doctor` warnings about unresolved peers or unreadable peer indexes are
operational guidance, not authorization and not evidence that a peer is safe.

Implementation: `src/domain/project-link.ts`,
`src/application/project-link.ts`, `src/application/report.ts`, and
`src/application/mcp-server.ts`. Full behavior:
[`docs/product/project-link.md`](product/project-link.md).

---

## Machine registry and paths

| Path | Purpose |
| --- | --- |
| `~/.5harness/registry.json` (or `$HARNESS_HOME`) | Registered project roots on this machine |
| `<project>/.5harness/index/` | Derived search index (rebuildable) |
| `<project>/.5harness/local/` | Machine-local data (traces, MCP logs, …) |

- Registry entries are **local path pointers**, not a cloud multi-tenant store.
- `harness link` / `unlink` only affect this machine’s registry.
- Do not point the registry at untrusted network shares you do not control.
- Override home with `HARNESS_HOME` only when you understand isolation between
  environments.

Implementation: `src/domain/paths.ts`, `src/application/registry.ts`.

---

## Secrets handling

| Concern | Practice |
| --- | --- |
| Logging | `redactSecrets` strips common token shapes (`npm_…`, `ghp_…`, `sk-…`, key=value) before file/console debug paths |
| Env | Prefer short-lived CI OIDC over long-lived `NPM_TOKEN` for publish |
| Commits | Never commit `.npmrc` with auth tokens, private keys, or production secrets |
| Agent traces | Treat worklogs/traces as potentially sensitive; they are machine-local by default |

Debug logging: `HARNESS_DEBUG`, optional `HARNESS_LOG_FILE`. Assume debug logs
may still contain paths and command text — redaction is best-effort, not a
guarantee against all secret formats.

Implementation: `src/infrastructure/logger.ts`.

---

## Dependency policy

| Rule | Detail |
| --- | --- |
| Runtime deps | Keep **minimal** (prefer zero or few production dependencies) |
| Dev deps | Test/build only; not required for end users of the global CLI |
| Updates | Dependabot (`.github/dependabot.yml`) for npm and GitHub Actions |
| Audit | Maintainers run `npm audit` before releases; CI should stay green on `release:check` |
| Pins | Lockfile (`package-lock.json`) is authoritative for CI installs (`npm ci`) |

New production dependencies require a clear need (size, maintenance, license).
Prefer Node built-ins for filesystem, HTTP, and crypto.

Published tarball contents are constrained by `package.json` `files` and
validated by `npm run pack:check` (see `scripts/pack-check.mjs`).

---

## Update check (npm)

On most commands (not bare `--help` / `--version`), the CLI may check the public
npm registry for a newer `5harness` version.

| Behavior | Detail |
| --- | --- |
| Frequency | Successful results are fresh for 1h; transient failures retry after 5m (cache: `~/.5harness/update-check.json`) |
| Effect | One-line **stderr** notice only; never blocks or changes exit codes |
| Fail-open | Network/errors are silent |
| Disable | `HARNESS_NO_UPDATE_CHECK=1`, or when `CI=true` / `CONTINUOUS_INTEGRATION` |
| Interval override | `HARNESS_UPDATE_CHECK_INTERVAL_MS` (milliseconds; tests/debug) |

No auto-upgrade is performed.

---

## Release provenance

Production releases (US-036 / decision 0018):

1. **CI matrix** runs `release:check` on multiple OS/Node versions.
2. **Publish** prefers **npm trusted publishing (OIDC)** with
   `npm publish --provenance` (green provenance on the package page when
   configured).
3. **GitHub Release** notes come from CHANGELOG; optional **SPDX SBOM** asset.
4. Long-lived **`NPM_TOKEN`** is optional fallback only.

### Consumer guidance

```bash
# Install a specific released version
npm i -g 5harness@<version>

# Prefer inspecting provenance on the npm package page for that version.
# After install, optional:
npm audit signatures
```

- Confirm the package name matches **`5harness`** (or the published
  successor name after any rename story).
- Prefer versions that show **provenance** attestations built from
  `github.com/vantanminh/5harness`.
- GitHub Release assets may include `sbom.spdx.json` for the release tag.

Full release procedure: [docs/product/distribution.md](product/distribution.md).

---

## Agent hard-fail (related)

Agents must not bypass harness CLI/MCP failures by hand-editing durable
entities. See decision **0017** and the harness block in `AGENTS.md` /
`templates/AGENTS.md`.

---

## Related files

| File | Role |
| --- | --- |
| [SECURITY.md](../SECURITY.md) | Public vulnerability reporting policy |
| [docs/product/distribution.md](product/distribution.md) | Install + release + OIDC setup |
| `.github/dependabot.yml` | Automated dependency PRs |
| `.github/workflows/ci.yml` / `release.yml` | Test matrix + provenance publish |
