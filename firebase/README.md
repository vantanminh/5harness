# Harness Cloud Firebase configuration

Firebase remains the identity provider and encrypted snapshot database for
Harness Cloud. The production API runs on Cloudflare Workers, so this project
does not deploy Firebase Functions and does not require the Blaze plan.

The historical `functions/` package is retained for emulator compatibility and
reference only. It is not included by the production deploy script.

## Prerequisites

- Node.js 22 or newer
- A Firebase project with Firestore and Authentication enabled
- Firebase CLI (`npm install -g firebase-tools`)

Sign in with the Firebase CLI, then select the project locally:

```bash
firebase login
cp .firebaserc.example .firebaserc
firebase use <your-firebase-project-id>
```

In Firebase Console, enable Google under Authentication → Sign-in method and
add the Cloudflare Worker hostname under Authentication → Settings →
Authorized domains. Add the Pages hostname too if it serves the dashboard.

## Local emulator

The Functions emulator is kept for the legacy backend tests. The production
Worker uses Firestore REST, so local Worker development normally uses the
Firestore emulator URL in `web/.dev.vars`:

```bash
npm run emulators
```

The Worker accepts `FIRESTORE_API_BASE_URL=http://127.0.0.1:8080` for this
loopback-only case. Do not put service-account JSON keys in the web app or
repository.

## Deploy Firebase resources

From this directory:

```bash
npm run deploy
```

This publishes only:

- Firebase Authentication provider configuration
- Firestore Security Rules
- Firestore composite indexes (currently none)

The rules permit a signed-in user to access only
`users/{uid}/projects/{projectId}` and validate the encrypted envelope schema.
OAuth codes, access/refresh credentials, quotas, and rate-limit buckets live
in Cloudflare KV instead of Firestore. Snapshot retention is enforced by the
Worker and expired documents are deleted opportunistically; Firebase TTL is
not enabled.

## Cloudflare Worker deployment

Configure the Firebase project id and public Web API key in
`web/wrangler.worker.jsonc`, then create the KV namespace and secret from
[`web/README.md`](../web/README.md):

```bash
npx wrangler kv namespace create OAUTH_KV
npx wrangler secret put RATE_LIMIT_SALT --config ../web/wrangler.worker.jsonc
npm --prefix ../web run deploy:worker
```

The Firebase Web API key is public client configuration. The Worker never uses
the Firebase Admin SDK, service-account credentials, Secret Manager, or a
Firebase Functions endpoint.

## Operations

Keep the exact browser origins in the Worker `CORS_ORIGINS` variable. Review
[`docs/product/cloud-sync.md`](../docs/product/cloud-sync.md) and
[`docs/SECURITY.md`](../docs/SECURITY.md#harness-cloud-sync) before changing
the owner-scoped rules, OAuth boundary, quotas, or retention behavior.
