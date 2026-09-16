# Harness Cloud web dashboard

The dashboard is a Vite + React Router single-page app served by the same
Cloudflare Worker as the Harness Cloud API. Firebase Auth handles human
sign-in; the Worker verifies Firebase ID tokens, calls Firestore through its
REST API, and stores OAuth state, grants, and quota counters in Cloudflare KV.
This keeps the Firebase project on the Spark plan: Firebase Functions,
firebase-admin, Secret Manager, and Firestore TTL are not part of production.

## Configure locally

```bash
npm install
cp .env.example .env.local
npm run check
npm test
npm run test:worker
npm run build
```

The hosted `harness5` Firebase web configuration is included as a public
fallback, so production builds do not depend on a local `.env` file. Set the
`VITE_FIREBASE_*` values from Firebase Console when pointing the dashboard at
another project or emulator. These values are safe to embed in a browser
bundle; they are not service credentials. The App Check site key is optional
for the Worker backend and may be left blank in local development.

For a local Worker, build the SPA, prepare the Worker-only asset directory,
copy `.dev.vars.example` to `.dev.vars`, then run:

```bash
npm run build
npm run worker:assets
npx wrangler dev --config wrangler.worker.jsonc
```

The Vite dev-server proxy keeps `/api` in the request path when
`VITE_WORKER_DEV=true` (the default). The legacy Firebase Functions emulator
is still available for historical tests; point `VITE_FIREBASE_API_URL` at its
project-shaped `/api` URL and set `VITE_WORKER_DEV=false` if you need it.

## Routes

- `/` — product landing page and Google sign-in
- `/authorize` — legacy OAuth consent screen for callback-based clients and MCP
- `/device` — device-code approval screen opened by `harness login`
- `/dashboard` — account-scoped encrypted snapshot metadata
- `/projects/:projectId` — local-in-browser unlock and manifest inspection
- `/settings` — setup, privacy boundary, and CLI session revocation
- `/mcp` — stateless MCP JSON-RPC endpoint protected by OAuth/KV

The passphrase is held only in React state while a snapshot is unlocked. The
Web Crypto API performs PBKDF2 and AES-GCM decryption in the browser; plaintext
is not sent to the backend.

## Cloudflare Worker deployment

Install and authenticate Wrangler once:

```bash
npx wrangler login
npx wrangler kv namespace create OAUTH_KV
npx wrangler types --config wrangler.worker.jsonc
```

Put the returned KV namespace id in `wrangler.worker.jsonc`. Set the Firebase
project id, public Web API key, and exact browser origins in that config. Keep
the rate-limit salt as a Worker secret and use at least 32 random bytes:

```bash
npx wrangler secret put RATE_LIMIT_SALT --config wrangler.worker.jsonc
npm run deploy:worker
```

`deploy:worker` builds the SPA, typechecks the Worker, removes the Pages-only
`_redirects` file from the Worker asset bundle, and deploys
`wrangler.worker.jsonc`. The Worker serves `/api/*`, `/authorize`, `/device`,
`/oauth/*`, `/.well-known/*`, `/mcp`, and the SPA assets from one origin. Use
the resulting `https://<worker>.<account>.workers.dev` URL as the CLI server:

```bash
harness login
# default https://5harness.knotree.com — override with --server if needed
harness login --server https://<worker>.<account>.workers.dev
```

The CLI prints an eight-character device code and opens (or displays) the
Worker's `/device` page. Sign in there and enter the code; the CLI polls the
PKCE-bound `/oauth/token` endpoint until the rotating credential is issued.
This avoids a loopback callback listener. After a successful approval the
terminal should print `Harness cloud login complete` without waiting for the
timeout. Check an existing session with `harness login --status`. The legacy
`/authorize` route stays available for existing OAuth clients.

The Worker configuration intentionally contains only public Firebase web
configuration. OAuth grant properties are encrypted by
`@cloudflare/workers-oauth-provider`; the salt is never bundled.

## Optional Pages compatibility deployment

The existing Pages project can continue serving the static dashboard. Deploy
the SPA with `npm run deploy`, then set its `FIREBASE_API_URL` runtime value to
the Worker API base, including `/api`:

```bash
npx wrangler pages secret put FIREBASE_API_URL --project-name=5harness-cloud
```

Enter `https://<worker>.<account>.workers.dev/api` when prompted. The Pages
Function forwards `/api/*` and cookies to the Worker; use the Worker URL for
the CLI and MCP OAuth server because Pages does not proxy root OAuth routes.
`FIREBASE_PROXY_TOKEN` is obsolete and is not required by the Worker.

## Production checklist

1. Enable Google sign-in and deploy Auth/Firestore rules from `../firebase`.
   The Firebase deploy script only publishes `auth`, `firestore:rules`, and
   `firestore:indexes`; it does not deploy Functions.
2. Add the Worker hostname (and the Pages hostname if it serves the UI) to
   Firebase Auth authorized domains.
3. Set exact `CORS_ORIGINS`; never use `*` for a credentialed browser origin.
4. Configure the `OAUTH_KV` namespace and `RATE_LIMIT_SALT` secret.
5. Run the Worker health check at `/api/health`, then use the returned Worker
   URL with `harness login` (default `https://5harness.knotree.com`) and
   `harness sync push`. Hosted MCP is served at `/mcp` on the same origin.
