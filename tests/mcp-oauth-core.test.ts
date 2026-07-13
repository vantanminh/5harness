import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  McpOAuthService,
  MCP_OAUTH_SCOPE,
  OAuthProtocolError,
  extractBearerToken,
} from "../src/application/mcp-oauth.js";

const verifier = "v".repeat(64);
const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
const issuer = "http://127.0.0.1:3928";
const resource = `${issuer}/mcp`;

function setup(now?: () => number) {
  const oauth = new McpOAuthService({ issuer, resource, now });
  const client = oauth.registerClient({
    client_name: "Test MCP client",
    redirect_uris: ["http://127.0.0.1:4567/callback"],
    token_endpoint_auth_method: "none",
  });
  return { oauth, client };
}

function authorizationParams(clientId: string): Record<string, string> {
  return {
    response_type: "code",
    client_id: clientId,
    redirect_uri: "http://127.0.0.1:4567/callback",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource,
    scope: MCP_OAUTH_SCOPE,
    state: "state-123",
  };
}

function issueCode(oauth: McpOAuthService, clientId: string): string {
  const pending = oauth.beginAuthorization(authorizationParams(clientId));
  const redirect = new URL(
    oauth.approveAuthorization(pending.requestId, {
      projectMode: "single",
      projectId: "project-1",
      availableProjectIds: ["project-1"],
    }),
  );
  expect(redirect.searchParams.get("state")).toBe("state-123");
  return redirect.searchParams.get("code")!;
}

describe("MCP OAuth 2.1 core", () => {
  it("publishes RFC discovery metadata with PKCE S256", () => {
    const { oauth } = setup();
    expect(oauth.authorizationServerMetadata()).toMatchObject({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      registration_endpoint: `${issuer}/register`,
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256"],
    });
    expect(oauth.protectedResourceMetadata()).toEqual({
      resource,
      authorization_servers: [issuer],
      scopes_supported: [MCP_OAUTH_SCOPE],
      bearer_methods_supported: ["header"],
    });
  });

  it("registers public clients with exact safe redirects", () => {
    const { client } = setup();
    expect(client.client_id).toMatch(/^harness_/);
    expect(client.token_endpoint_auth_method).toBe("none");
    expect(() => setup().oauth.registerClient({ redirect_uris: ["http://evil.example/cb"] }))
      .toThrowError(OAuthProtocolError);
    expect(() => setup().oauth.registerClient({ redirect_uris: ["https://client.example/cb#fragment"] }))
      .toThrow(/redirect/i);
  });

  it("exchanges a one-time code using PKCE and validates its audience", () => {
    const { oauth, client } = setup();
    const code = issueCode(oauth, client.client_id);
    const result = oauth.exchangeAuthorizationCode({
      grant_type: "authorization_code",
      code,
      client_id: client.client_id,
      redirect_uri: client.redirect_uris[0],
      code_verifier: verifier,
      resource,
    });
    expect(result).toMatchObject({ token_type: "Bearer", expires_in: 3600, scope: MCP_OAUTH_SCOPE });
    const token = result.access_token as string;
    expect(oauth.validateAccessToken(token)).toMatchObject({
      ok: true,
      resource,
      projectMode: "single",
      projectIds: ["project-1"],
    });
    expect(oauth.validateAccessToken(token, "http://127.0.0.1:9999/mcp")).toEqual({
      ok: false,
      reason: "wrong_audience",
    });
    expect(() => oauth.exchangeAuthorizationCode({
      grant_type: "authorization_code",
      code,
      client_id: client.client_id,
      redirect_uri: client.redirect_uris[0],
      code_verifier: verifier,
      resource,
    })).toThrow(/already used/);
  });

  it("issues all-project grants and rejects forged single-project choices", () => {
    const { oauth, client } = setup();
    const pending = oauth.beginAuthorization(authorizationParams(client.client_id));
    expect(() =>
      oauth.approveAuthorization(pending.requestId, {
        projectMode: "single",
        projectId: "not-linked",
        availableProjectIds: ["project-1"],
      }),
    ).toThrow(/currently linked/);

    const redirect = new URL(
      oauth.approveAuthorization(pending.requestId, {
        projectMode: "all",
        availableProjectIds: ["project-1"],
      }),
    );
    const result = oauth.exchangeAuthorizationCode({
      grant_type: "authorization_code",
      code: redirect.searchParams.get("code")!,
      client_id: client.client_id,
      redirect_uri: client.redirect_uris[0],
      code_verifier: verifier,
      resource,
    });
    expect(result).toMatchObject({ project_mode: "all", project_ids: [] });
    expect(oauth.validateAccessToken(result.access_token as string)).toMatchObject({
      ok: true,
      projectMode: "all",
      projectIds: [],
    });
  });

  it("rejects PKCE downgrade, redirect mismatch, wrong verifier, and wrong resource", () => {
    const { oauth, client } = setup();
    expect(() => oauth.beginAuthorization({
      ...authorizationParams(client.client_id),
      code_challenge_method: "plain",
    })).toThrow(/S256/);
    expect(() => oauth.beginAuthorization({
      ...authorizationParams(client.client_id),
      redirect_uri: "http://127.0.0.1:4567/other",
    })).toThrow(/exactly match/);
    expect(() => oauth.beginAuthorization({
      ...authorizationParams(client.client_id),
      resource: "http://127.0.0.1:9999/mcp",
    })).toThrow(/resource/);

    const code = issueCode(oauth, client.client_id);
    expect(() => oauth.exchangeAuthorizationCode({
      grant_type: "authorization_code",
      code,
      client_id: client.client_id,
      redirect_uri: client.redirect_uris[0],
      code_verifier: "x".repeat(64),
      resource,
    })).toThrow(/PKCE/);
  });

  it("expires authorization codes and access tokens", () => {
    let time = 1_000_000;
    const { oauth, client } = setup(() => time);
    const expiredCode = issueCode(oauth, client.client_id);
    time += 5 * 60_000 + 1;
    expect(() => oauth.exchangeAuthorizationCode({
      grant_type: "authorization_code",
      code: expiredCode,
      client_id: client.client_id,
      redirect_uri: client.redirect_uris[0],
      code_verifier: verifier,
      resource,
    })).toThrow(/expired/);

    const code = issueCode(oauth, client.client_id);
    const token = oauth.exchangeAuthorizationCode({
      grant_type: "authorization_code",
      code,
      client_id: client.client_id,
      redirect_uri: client.redirect_uris[0],
      code_verifier: verifier,
      resource,
    }).access_token as string;
    time += 60 * 60_000 + 1;
    expect(oauth.validateAccessToken(token)).toEqual({ ok: false, reason: "expired" });
  });

  it("preserves state on denial and parses only Bearer authorization headers", () => {
    const { oauth, client } = setup();
    const pending = oauth.beginAuthorization(authorizationParams(client.client_id));
    const denied = new URL(oauth.denyAuthorization(pending.requestId));
    expect(denied.searchParams.get("error")).toBe("access_denied");
    expect(denied.searchParams.get("state")).toBe("state-123");
    expect(extractBearerToken("Bearer abc_123.~-")).toBe("abc_123.~-");
    expect(extractBearerToken("Basic abc")).toBeUndefined();
    expect(extractBearerToken(["Bearer abc"])).toBeUndefined();
  });
});
