# Harness Cloud Sync

Harness Cloud is an optional hosted companion for the npm CLI. It synchronizes
the Git-backed durable markdown history of a project across trusted devices;
the repository remains the source of truth.

## Data flow

```text
harness login                 # default https://5harness.knotree.com
    -> Cloudflare Worker /oauth/device/code
    -> Firebase Auth at the device verification page
    -> PKCE-bound device approval and token polling (no loopback callback)
    -> rotated opaque CLI credentials in ~/.5harness/auth.json
harness login --status
    -> local credential file, without starting a new device-code flow

harness sync push (first time stores the passphrase locally)
    -> deterministic durable-file manifest + changed-path commit
    -> PBKDF2-HMAC-SHA256 + AES-256-GCM snapshot on the client
    -> user-scoped harness catalog for hosted MCP reads
    -> Cloudflare Worker API
    -> Firebase Firestore REST under users/{uid}/projects/{projectId}
    -> commits/{commitId} and views/catalog

later durable CLI mutations
    -> auto-sync the same path without a manual push
```

The Worker verifies Firebase ID tokens with Google's Secure Token JWKS and
refreshes Firebase sessions when serving CLI/MCP requests. OAuth codes,
tokens, encrypted grant properties, quotas, and rate-limit buckets are stored
in Cloudflare KV through `@cloudflare/workers-oauth-provider`. No Firebase
Functions, Admin SDK, Secret Manager, or Firestore TTL is required, so the
Firebase project can remain on Spark.

The Worker also serves the SPA assets. An existing Cloudflare Pages project
may proxy `/api/*` to the Worker for dashboard compatibility, but the Worker
URL is the canonical CLI and MCP OAuth server.

## What is synchronized

The CLI includes UTF-8 Markdown files below these project-relative roots:

- `docs/stories/`
- `docs/decisions/`
- `docs/intakes/`
- `docs/backlog/`
- `docs/reports/`

`README.md` files, `.5harness/`, `AGENTS.md`, credentials, traces, indexes, and
arbitrary project files are excluded. A pull validates the project id, file
hashes, UTF-8 content, and confined paths before making atomic local writes.

Each upload also records a GitHub-like **commit**: id, time, author, source
client, message, and changed paths only. The dashboard lists those commits and
opens a detail view. A separate catalog of harness entities (not source code)
is stored so hosted MCP can read the designated project sequentially.

After login and the first successful `sync push`, durable mutations auto-sync
using the stored passphrase or `HARNESS_SYNC_PASSPHRASE`. Set
`HARNESS_AUTO_SYNC=0` to disable.

## Hosted MCP and implementation briefs

Web AIs connect to `https://5harness.knotree.com/mcp` with the same OAuth user
as `harness login`. Tools:

1. `harness_cloud_guide` / initialize instructions — sequential read order
2. `harness_projects` — list synced projects; the user designates one
3. `harness_project_overview` / `harness_search` / `harness_entities`
4. `harness_get` — one entity at a time
5. `harness_plan_create` — store idea, research, detailed plan, and a complete
   coding-agent prompt; returns token `please implement plan from harness --TOKEN`
6. `harness_plan_get` — load that brief by token

Coding agents run `harness plan get TOKEN` (CLI or local MCP `harness_plan_get`)
to receive the full plan and prompt. Do not invent the token.

## Conflict behavior

Each project has one encrypted snapshot per Firebase account. Push uses a
Firestore REST compare-and-swap on the document update time and the logical
revision. A stale remote revision returns a conflict instead of silently
overwriting another device. Pull checks the local file digest since the last
successful sync; local divergence requires the explicit
`harness sync pull --force` flag. `--prune` is separate and must be requested
to remove local durable Markdown that is absent from the snapshot.

## Security boundary

- The sync passphrase is never sent to Firebase. It derives the AES key locally.
- Firestore rules allow a signed-in user to access only that user's project
  documents and validate the encrypted envelope shape.
- Browser API routes require a verified Firebase ID token. CLI and MCP routes
  use short-lived OAuth access tokens whose grant properties are encrypted in
  KV and contain a refresh credential only for the same Firebase account.
- Access tokens are opaque; only hashes are stored. Refresh tokens rotate, and
  replay revokes the whole refresh family.
- Payload size, file count, project count, request rate, daily operations, daily
  bytes, and retention are bounded in the Worker. IP rate-limit keys are salted
  hashes, not raw addresses.
- CLI login uses a short-lived RFC 8628-style device code, a PKCE S256
  verifier, and one-time authorization codes held by the Worker. The browser
  only approves the displayed user code; no loopback listener or callback URL
  is required. Existing `/authorize` callback clients remain compatible.
- No service-account key belongs in the browser or repo.

## Deployment guides

- [Firebase Auth and Firestore](../../firebase/README.md)
- [Cloudflare Worker and dashboard](../../web/README.md)
- [Security model](../SECURITY.md#harness-cloud-sync)

The Firebase project id, Firebase web configuration, Cloudflare KV namespace,
Worker rate-limit secret, CORS origins, and optional Pages project are
deployment inputs. The Firebase Web API key is public configuration; the
rate-limit salt and OAuth data remain outside the repository.
