---
created_at: "2026-09-15T23:07:30.559218+00:00"
doc: docs/decisions/0025-cloud-sync-firebase.md
id: "0025"
links:
  - IN-027
  - "0017"
  - "0019"
  - "0024"
notes: "Accepted for IN-027. Cloudflare Pages hosts a Vite/React Router SPA; a Pages Function proxies /api to Firebase Functions. Browser users authenticate with Firebase Auth and approve short-lived one-time OAuth authorization codes using PKCE for harness login. The CLI stores only rotated opaque refresh credentials in the machine-local Harness home and sends bearer access tokens to a Firebase Functions API. Durable markdown is serialized deterministically and encrypted locally with PBKDF2-HMAC-SHA256 plus AES-256-GCM before upload; Firebase stores only user-scoped ciphertext and metadata. Firestore client access is deny-by-default; Admin SDK remains server-only. Backend limits payload/schema/project scope, applies App Check to browser routes, per-user/day quotas, hashed-IP rate limiting, token TTL/rotation/replay detection, and exact loopback redirects. Sync pull detects local divergence and requires explicit --force for replacement; writes use atomic CLI paths."
status: accepted
title: "Cloud sync uses Firebase API, browser OAuth PKCE, and client-side encrypted envelopes"
type: decision
updated_at: "2026-09-15T23:07:30.559220200+00:00"
verify: cargo test; npm --prefix firebase/functions run build; npm --prefix web run build
---

# Cloud sync uses Firebase API, browser OAuth PKCE, and client-side encrypted envelopes
