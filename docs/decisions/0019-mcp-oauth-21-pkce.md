---
id: 0019-mcp-oauth-21-pkce
type: decision
title: Embedded OAuth 2.1 and PKCE boundary for MCP
status: accepted
doc: docs/decisions/0019-mcp-oauth-21-pkce.md
verify: npx vitest run tests/mcp-oauth-core.test.ts tests/mcp-oauth-http.test.ts tests/mcp-oauth-security.test.ts
notes: "The MCP HTTP service is an RFC 9728 protected resource and embeds a machine-local OAuth authorization server. Public clients use authorization_code only with mandatory PKCE S256, exact registered redirects, state round-trip, resource indicators and short-lived opaque bearer tokens bound to the canonical MCP URI. Dynamic registration supports generic MCP clients. Dashboard cookie sessions authenticate the human approval step but never authorize MCP calls; standalone approval uses the same machine-local admin credential. OAuth secrets, codes and tokens remain machine-local and are never logged. Non-loopback OAuth requires an explicitly safe HTTPS deployment boundary; localhost HTTP remains supported for native-client interoperability."
created_at: "2026-07-13T05:34:58.776Z"
updated_at: "2026-07-13T05:52:08.406Z"
links:
  - IN-009
  - US-045
  - US-046
  - US-047
  - US-027
  - US-042
last_verified_at: "2026-07-13T05:52:08.406Z"
last_verified_result: pass
---

# Embedded OAuth 2.1 and PKCE boundary for MCP
