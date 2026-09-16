# Historical Firebase Functions backend

This package is retained for emulator and migration reference only. Harness
Cloud production runs on the Cloudflare Worker in `web/worker/`, using Firebase
ID-token verification, Firestore REST, and Cloudflare KV so the Firebase
project can remain on Spark.

Do not deploy this package in production. `firebase/package.json` intentionally
deploys only Firebase Auth, Firestore rules, and Firestore indexes.
