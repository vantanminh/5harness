---
created_at: "2026-09-16T06:08:56.268709300+00:00"
doc: docs/decisions/0026-cloud-sync-cloudflare-worker.md
id: "0026"
links:
  - IN-031
  - US-103
  - "0025"
notes: "Because Firebase project harness5 remains on Spark, production cloud sync moves from Firebase Functions/Admin SDK to a Cloudflare Worker modeled on StudyOS MCP. The Worker verifies Firebase ID tokens with Google JWKS, exchanges encrypted Firebase refresh credentials for short-lived ID tokens, calls Firestore REST under owner-scoped Security Rules, and delegates OAuth code/token/grant storage plus encrypted grant props to @cloudflare/workers-oauth-provider backed by KV. Cloudflare Worker secrets and KV replace Firebase Secret Manager and Firestore TTL; snapshot retention is enforced on every Worker read/write and stale documents are deleted opportunistically. The existing /api OAuth and sync paths remain compatible with the Rust CLI and dashboard."
status: accepted
title: Cloud sync backend runs on a Cloudflare Worker with Firebase REST and KV
type: decision
updated_at: "2026-09-16T06:08:56.268712600+00:00"
verify: npm --prefix web run check; npm --prefix web test; npm --prefix web run build; npx wrangler deploy --config wrangler.worker.jsonc --dry-run
---

# Cloud sync backend runs on a Cloudflare Worker with Firebase REST and KV
