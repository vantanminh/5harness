# Harness Cloud web dashboard

The dashboard is a Vite + React Router single-page app deployed to Cloudflare
Pages. Pages Functions proxy `/api/*` to Firebase Functions, while Firebase
Auth handles the human browser session.

## Configure locally

```bash
npm install
cp .env.example .env.local
npm run check
npm test
npm run build
```

Fill the public `VITE_FIREBASE_*` values from Firebase Console. These values
are safe to embed in a browser bundle; they are not service credentials. Set
`VITE_FIREBASE_APPCHECK_SITE_KEY` to the reCAPTCHA v3 site key used by Firebase
App Check.

For a local Firebase emulator, set `VITE_FIREBASE_API_URL` to the full
project-shaped Functions URL described in `firebase/README.md`. In production,
leave `VITE_API_BASE_URL` at its default `/api`: the Pages Function forwards the
request to the runtime `FIREBASE_API_URL` variable.

## Routes

- `/` — product landing page and Google sign-in
- `/authorize` — PKCE consent screen used by `harness login`
- `/dashboard` — account-scoped encrypted snapshot metadata
- `/projects/:projectId` — local-in-browser unlock and manifest inspection
- `/settings` — setup, privacy boundary, and CLI session revocation

The passphrase is held only in React state while a snapshot is unlocked. The
Web Crypto API performs PBKDF2 and AES-GCM decryption in the browser; plaintext
is not sent to the backend.

## Cloudflare Pages deployment

Install and authenticate Wrangler once, then create the Pages project:

```bash
npx wrangler login
npx wrangler pages project create 5harness-cloud
```

Set the Firebase Functions URL as a Pages runtime variable/secret. The value is
an endpoint, not a credential, but keeping it out of source makes staging and
production safer to operate:

```bash
npx wrangler pages secret put FIREBASE_API_URL --project-name=5harness-cloud
```

When prompted, enter the deployed Firebase URL ending in `/api`. Configure the
public `VITE_FIREBASE_*` values in the Pages project build environment (or in a
local, ignored `.env.production.local` for direct uploads). Then deploy from
this directory:

```bash
npm run deploy
```

`wrangler.jsonc` sets the Pages output directory and compatibility date.
`functions/api/[[path]].ts` is included from the project root, and
`public/_redirects` keeps client-side React Router paths working on refresh.
Use `npm run deploy:preview` for a preview branch, and add that preview origin
to Firebase `WEB_ORIGINS` before testing browser API calls.

## Production checklist

1. Deploy Firebase Functions and Firestore rules first.
2. Register the Pages hostname in Firebase Auth authorized domains.
3. Register the Pages web app in Firebase App Check and set its site key.
4. Set `WEB_ORIGINS` to exact production/preview origins; never use `*`.
5. Set `FIREBASE_API_URL` in Pages and the public `VITE_FIREBASE_*` build vars.
6. Run `harness login --server https://<pages-domain>` and then
   `harness sync push` with a long passphrase.
