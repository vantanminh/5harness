# Harness Cloud Sync

Harness Cloud is an optional hosted companion for the npm CLI. It synchronizes
the Git-backed durable markdown history of a project across trusted devices;
the repository remains the source of truth.

## Data flow

```text
harness login
    -> Cloudflare Pages /authorize
    -> Firebase Auth in the browser
    -> one-time PKCE code to the loopback CLI callback
    -> rotated opaque CLI credentials in ~/.5harness/auth.json

harness sync push
    -> deterministic durable-file manifest
    -> PBKDF2-HMAC-SHA256 + AES-256-GCM on the client
    -> Firebase Functions API
    -> user-scoped Firestore ciphertext
```

The browser dashboard uses Firebase Auth and a Pages Function proxy at `/api/*`.
The proxy keeps the Firebase Functions origin out of browser CORS setup and
keeps the backend URL out of the static application bundle. The Firebase Admin
SDK is used only inside Functions.
The proxy also injects a high-entropy `FIREBASE_PROXY_TOKEN`; Functions require
the matching `CLOUD_PROXY_TOKEN` secret, so the public Firebase URL is not a
usable unauthenticated write surface.

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

## Conflict behavior

Each project has one encrypted snapshot per Firebase account. Push uses a
revision compare-and-swap. A stale remote revision returns a conflict instead
of silently overwriting another device. Pull checks the local file digest since
the last successful sync; local divergence requires the explicit
`harness sync pull --force` flag. `--prune` is separate and must be requested to
remove local durable Markdown that is absent from the snapshot.

## Security boundary

- The sync passphrase is never sent to Firebase. It derives the AES key locally.
- Firestore client rules deny every direct read and write; only Admin SDK code
  in Functions can access documents.
- Browser routes require Firebase Auth plus Firebase App Check. CLI routes use
  short-lived access tokens issued after PKCE authorization.
- Access tokens are opaque; only hashes are stored. Refresh tokens rotate, and
  replay revokes the whole refresh family.
- Payload size, file count, project count, request rate, daily operations, daily
  bytes, and retention are bounded in the backend. IP rate-limit keys are
  salted hashes, not raw addresses.
- The Pages-to-Firebase proxy token is stored only as a Cloudflare Pages secret
  and Firebase Secret Manager value; the proxy overwrites client-supplied
  copies before forwarding.
- OAuth redirects are exact loopback callbacks with PKCE S256 and one-time
  authorization codes. No service-account key belongs in the browser or repo.

## Deployment guides

- [Firebase Functions and Firestore](../../firebase/README.md)
- [Vite + Cloudflare Pages](../../web/README.md)
- [Security model](../SECURITY.md#harness-cloud-sync)

The Firebase project id, Firebase web configuration, Pages project, App Check
site key, CORS origins, and Secret Manager value are deployment inputs. They are
intentionally not committed to this repository.
