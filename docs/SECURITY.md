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
| Machine registry (`~/.harness`) | Local user | Paths on this machine |
| Dashboard | Loopback HTTP | `127.0.0.1` by default |
| MCP server | Loopback / stdio as configured | Local only by default |
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
| Auth model | **Local only** — no remote multi-user auth layer |
| Default bind | `127.0.0.1` (see `harness mcp` / dashboard `--host`) |
| Mutation surface | Read-oriented tools today; agents should still follow AGENTS hard-fail rules |
| Call log | `.harness/local/mcp-calls.jsonl` under the project (machine-local) |

Binding MCP or the dashboard to a non-loopback address exposes project paths,
index data, and tool responses to anyone who can reach that host:port. Keep
defaults unless you have an explicit network model.

Implementation: `src/application/mcp-server.ts`, `src/application/dashboard.ts`.

---

## Machine registry and paths

| Path | Purpose |
| --- | --- |
| `~/.harness/registry.json` (or `$HARNESS_HOME`) | Registered project roots on this machine |
| `<project>/.harness/index/` | Derived search index (rebuildable) |
| `<project>/.harness/local/` | Machine-local data (traces, MCP logs, …) |

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
npm registry for a newer `@vantanminh/harness` version.

| Behavior | Detail |
| --- | --- |
| Frequency | At most one registry fetch per 24h (cache: `~/.harness/update-check.json`) |
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
npm i -g @vantanminh/harness@<version>

# Prefer inspecting provenance on the npm package page for that version.
# After install, optional:
npm audit signatures
```

- Confirm the package name matches **`@vantanminh/harness`** (or the published
  successor name after any rename story).
- Prefer versions that show **provenance** attestations built from
  `github.com/vantanminh/harness`.
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
