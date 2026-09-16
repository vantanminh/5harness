# Harness Cloud Firebase backend

This directory contains the Firebase Functions API and the deny-by-default
Firestore policy used by Harness Cloud. The API stores encrypted envelopes;
it never receives the sync passphrase or plaintext durable Markdown.

## Prerequisites

- Node.js 22 or newer
- A Firebase project with Firestore and Authentication enabled
- Firebase CLI (`npm install -g firebase-tools`)

Sign in with the Firebase CLI, then select the project locally:

```bash
firebase login
cp .firebaserc.example .firebaserc
firebase use <your-firebase-project-id>
npm --prefix functions install
npm --prefix functions run build
npm --prefix functions test
```

`.firebaserc` is ignored and must not be committed. In Firebase Console,
enable Google under Authentication → Sign-in method and add the Cloudflare
Pages hostname under Authentication → Settings → Authorized domains.

## Configure the backend

Copy `functions/.env.example` to `functions/.env` and set exact origins:

```text
WEB_ORIGINS=https://<pages-project>.pages.dev,http://localhost:5173
ENFORCE_APP_CHECK=true
```

For an emulator, set a random local `RATE_LIMIT_SALT` in that file. For a
deployed function, remove the local value and create a Firebase Secret Manager
version instead:

```bash
firebase functions:secrets:set RATE_LIMIT_SALT
```

Use at least 32 random bytes. The function declares this secret explicitly and
fails closed with `service_misconfigured` if it is absent. Do not use a service
account JSON key in the web app or commit one to this repository.

Create a separate random `CLOUD_PROXY_TOKEN` as well. The Pages Function sends
it in a private header and Firebase rejects direct API calls without the
matching value. Use the local value in `functions/.env` for emulator work; in
production store it as a second Firebase secret:

```bash
firebase functions:secrets:set CLOUD_PROXY_TOKEN
```

## App Check

Register the web application in Firebase App Check with a reCAPTCHA Enterprise
score key restricted to the deployed Pages hostname, and put its site key in
`web/.env.local` as
`VITE_FIREBASE_APPCHECK_SITE_KEY`. Keep `ENFORCE_APP_CHECK=true` for deployed
Functions. The emulator bypasses App Check only when Firebase sets
`FUNCTIONS_EMULATOR=true`.

## Deploy

From this directory, deploy the Functions API, Firestore rules, and TTL/index
configuration:

```bash
npm run deploy
```

The API endpoint is:

```text
https://us-central1-<your-firebase-project-id>.cloudfunctions.net/api
```

Set this URL as `FIREBASE_API_URL` in the Cloudflare Pages project. When using a
custom Firebase region, update both `firebase/firebase.json` and the URL used
by the Pages proxy before deploying.

## Local emulator

Set a local `RATE_LIMIT_SALT` in `functions/.env`, then run:

```bash
npm run emulators
```

The Functions emulator uses a project-shaped URL. For Vite, set
`VITE_FIREBASE_API_URL` to:

```text
http://127.0.0.1:5001/<your-firebase-project-id>/us-central1/api
```

The Firestore rules intentionally deny direct client access. Local requests
still go through the Functions API so emulator behavior matches production.

## Operations

The backend has bounded Firebase Functions instances, exact CORS origins,
App Check, salted IP rate limits, per-account quotas, per-account project caps,
payload/file limits, token expiry/rotation/replay detection, and Firestore TTL
cleanup. Review `docs/product/cloud-sync.md` and
`docs/SECURITY.md#harness-cloud-sync` before changing those controls.
