import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startDashboard } from "../src/application/dashboard.js";
import { McpOAuthService, MCP_OAUTH_SCOPE } from "../src/application/mcp-oauth.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("MCP OAuth security boundaries", () => {
  it("allows plaintext only for loopback and binds embedded issuer/resource origins", () => {
    expect(() => new McpOAuthService({
      issuer: "http://mcp.example.com",
      resource: "http://mcp.example.com/mcp",
    })).toThrow(/HTTPS/);
    expect(() => new McpOAuthService({
      issuer: "https://auth.example.com",
      resource: "https://mcp.example.com/mcp",
    })).toThrow(/same origin/);
    expect(() => new McpOAuthService({
      issuer: "https://mcp.example.com/prefix",
      resource: "https://mcp.example.com/prefix/mcp",
    })).toThrow(/without a path/);
  });

  it("refuses non-loopback dashboard exposure without a canonical HTTPS public URL", async () => {
    await expect(startDashboard({ host: "0.0.0.0", port: 0 })).rejects.toThrow(/--public-url/);
  });

  it("returns no-store hardened errors and rejects unsafe dynamic registration", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-oauth-security-home-"));
    tempDirs.push(home);
    const dashboard = await startDashboard({ host: "127.0.0.1", port: 0, harnessHome: home });
    try {
      const malformed = await fetch(`${dashboard.url}register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{not-json",
      });
      expect(malformed.status).toBe(400);
      expect(malformed.headers.get("cache-control")).toBe("no-store");
      expect(malformed.headers.get("content-security-policy")).toContain(
        "form-action 'self'; frame-ancestors 'none'",
      );
      await expect(malformed.json()).resolves.toMatchObject({ error: "invalid_request" });

      const unsafe = await fetch(`${dashboard.url}register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirect_uris: ["http://attacker.example/callback"] }),
      });
      expect(unsafe.status).toBe(400);
      await expect(unsafe.json()).resolves.toMatchObject({ error: "invalid_redirect_uri" });
    } finally {
      await dashboard.close();
    }
  });

  it("never accepts access tokens from URI query parameters", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-oauth-query-home-"));
    tempDirs.push(home);
    const dashboard = await startDashboard({ host: "127.0.0.1", port: 0, harnessHome: home });
    try {
      const verifier = "s".repeat(64);
      const codeChallenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
      const clientResponse = await fetch(`${dashboard.url}register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ redirect_uris: ["http://localhost:8123/callback"] }),
      });
      const client = await clientResponse.json() as { client_id: string };
      const authorize = new URL(`${dashboard.url}authorize`);
      authorize.search = new URLSearchParams({
        response_type: "code",
        client_id: client.client_id,
        redirect_uri: "http://localhost:8123/callback",
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        resource: `${dashboard.url}mcp`,
        scope: MCP_OAUTH_SCOPE,
      }).toString();
      const page = await fetch(authorize);
      const requestId = /name="request_id" value="([^"]+)"/.exec(await page.text())?.[1];
      const approval = await fetch(`${dashboard.url}authorize`, {
        method: "POST",
        redirect: "manual",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          request_id: requestId!, username: "admin", password: "admin", action: "approve",
        }),
      });
      const code = new URL(approval.headers.get("location")!).searchParams.get("code")!;
      const tokenResponse = await fetch(`${dashboard.url}token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: client.client_id,
          redirect_uri: "http://localhost:8123/callback",
          code_verifier: verifier,
          resource: `${dashboard.url}mcp`,
        }),
      });
      const token = await tokenResponse.json() as { access_token: string };
      const response = await fetch(`${dashboard.url}mcp?access_token=${encodeURIComponent(token.access_token)}`, {
        method: "POST",
        body: "{}",
      });
      expect(response.status).toBe(401);
    } finally {
      await dashboard.close();
    }
  });
});
