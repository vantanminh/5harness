import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const MCP_OAUTH_SCOPE = "mcp:access";
const CODE_TTL_MS = 5 * 60_000;
const TOKEN_TTL_MS = 60 * 60_000;
const PKCE_VALUE = /^[A-Za-z0-9._~-]{43,128}$/;
const MAX_IN_MEMORY_RECORDS = 1_000;

export class OAuthProtocolError extends Error {
  constructor(
    public readonly error: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "OAuthProtocolError";
  }
}

export type OAuthClient = {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  grant_types: ["authorization_code"];
  response_types: ["code"];
  token_endpoint_auth_method: "none";
  client_id_issued_at: number;
};

type PendingAuthorization = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  scope: string;
  state?: string;
  expiresAt: number;
};

type AuthorizationCode = PendingAuthorization & { used: boolean };
type AccessGrant = {
  clientId: string;
  resource: string;
  scope: string;
  expiresAt: number;
};

export type TokenValidation =
  | { ok: true; clientId: string; resource: string; scope: string; expiresAt: number }
  | { ok: false; reason: "missing" | "invalid" | "expired" | "wrong_audience" | "insufficient_scope" };

function opaque(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

function sha256Base64Url(value: string): string {
  return createHash("sha256").update(value, "ascii").digest("base64url");
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new OAuthProtocolError("invalid_request", `${name} is required`);
  }
  return value;
}

function validRedirectUri(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.hash || url.username || url.password) return false;
    if (url.protocol === "https:") return true;
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]")
    );
  } catch {
    return false;
  }
}

function normalizeBaseUri(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URI`);
  }
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

function readParam(params: URLSearchParams | Record<string, unknown>, name: string): string | undefined {
  const value = params instanceof URLSearchParams ? params.get(name) : params[name];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export class McpOAuthService {
  readonly issuer: string;
  readonly resource: string;

  private readonly clients = new Map<string, OAuthClient>();
  private readonly pending = new Map<string, PendingAuthorization>();
  private readonly codes = new Map<string, AuthorizationCode>();
  private readonly tokens = new Map<string, AccessGrant>();

  constructor(options: { issuer: string; resource: string; now?: () => number }) {
    this.issuer = normalizeBaseUri(options.issuer, "issuer");
    this.resource = normalizeBaseUri(options.resource, "resource");
    const issuer = new URL(this.issuer);
    const resource = new URL(this.resource);
    if (issuer.pathname !== "/") {
      throw new Error("embedded OAuth issuer must be an origin URL without a path");
    }
    const loopback = issuer.hostname === "localhost" || issuer.hostname === "127.0.0.1" ||
      issuer.hostname === "[::1]" || issuer.hostname === "::1";
    if (issuer.protocol !== "https:" && !(issuer.protocol === "http:" && loopback)) {
      throw new Error("OAuth issuer must use HTTPS unless it is a localhost loopback URI");
    }
    if (issuer.origin !== resource.origin) {
      throw new Error("embedded OAuth issuer and MCP resource must use the same origin");
    }
    this.now = options.now ?? Date.now;
  }

  private readonly now: () => number;

  authorizationServerMetadata(): Record<string, unknown> {
    return {
      issuer: this.issuer,
      authorization_endpoint: `${this.issuer}/authorize`,
      token_endpoint: `${this.issuer}/token`,
      registration_endpoint: `${this.issuer}/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      token_endpoint_auth_methods_supported: ["none"],
      code_challenge_methods_supported: ["S256"],
      scopes_supported: [MCP_OAUTH_SCOPE],
      resource_indicators_supported: true,
    };
  }

  protectedResourceMetadata(): Record<string, unknown> {
    return {
      resource: this.resource,
      authorization_servers: [this.issuer],
      scopes_supported: [MCP_OAUTH_SCOPE],
      bearer_methods_supported: ["header"],
    };
  }

  registerClient(input: Record<string, unknown>): OAuthClient {
    if (this.clients.size >= MAX_IN_MEMORY_RECORDS) {
      throw new OAuthProtocolError("temporarily_unavailable", "client registration capacity reached", 429);
    }
    if (!Array.isArray(input.redirect_uris) || input.redirect_uris.length === 0) {
      throw new OAuthProtocolError("invalid_client_metadata", "redirect_uris must be a non-empty array");
    }
    const redirectUris = input.redirect_uris.map((uri) => requireString(uri, "redirect_uri"));
    if (new Set(redirectUris).size !== redirectUris.length || redirectUris.some((uri) => !validRedirectUri(uri))) {
      throw new OAuthProtocolError(
        "invalid_redirect_uri",
        "redirect URIs must be unique HTTPS or localhost loopback URIs without fragments",
      );
    }
    if (input.token_endpoint_auth_method !== undefined && input.token_endpoint_auth_method !== "none") {
      throw new OAuthProtocolError("invalid_client_metadata", "only public clients are supported");
    }
    const client: OAuthClient = {
      client_id: `harness_${opaque(18)}`,
      client_name: typeof input.client_name === "string" && input.client_name.trim()
        ? input.client_name.trim().slice(0, 200)
        : "MCP client",
      redirect_uris: redirectUris,
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      client_id_issued_at: Math.floor(this.now() / 1000),
    };
    this.clients.set(client.client_id, client);
    return structuredClone(client);
  }

  beginAuthorization(params: URLSearchParams | Record<string, unknown>): {
    requestId: string;
    clientName: string;
    scope: string;
    resource: string;
  } {
    if (this.pending.size >= MAX_IN_MEMORY_RECORDS) {
      throw new OAuthProtocolError("temporarily_unavailable", "authorization request capacity reached", 429);
    }
    if (readParam(params, "response_type") !== "code") {
      throw new OAuthProtocolError("unsupported_response_type", "response_type must be code");
    }
    const clientId = requireString(readParam(params, "client_id"), "client_id");
    const client = this.clients.get(clientId);
    if (!client) throw new OAuthProtocolError("invalid_request", "unknown client_id");
    const redirectUri = requireString(readParam(params, "redirect_uri"), "redirect_uri");
    if (!client.redirect_uris.includes(redirectUri)) {
      throw new OAuthProtocolError("invalid_request", "redirect_uri does not exactly match registration");
    }
    const codeChallenge = requireString(readParam(params, "code_challenge"), "code_challenge");
    if (!PKCE_VALUE.test(codeChallenge) || readParam(params, "code_challenge_method") !== "S256") {
      throw new OAuthProtocolError("invalid_request", "PKCE S256 is required");
    }
    const resource = requireString(readParam(params, "resource"), "resource");
    if (resource !== this.resource) {
      throw new OAuthProtocolError("invalid_target", "resource does not identify this MCP server");
    }
    const scope = readParam(params, "scope") ?? MCP_OAUTH_SCOPE;
    if (scope.split(/\s+/).some((item) => item !== MCP_OAUTH_SCOPE)) {
      throw new OAuthProtocolError("invalid_scope", `supported scope: ${MCP_OAUTH_SCOPE}`);
    }
    const requestId = opaque();
    this.pending.set(requestId, {
      clientId,
      redirectUri,
      codeChallenge,
      resource: this.resource,
      scope,
      state: readParam(params, "state"),
      expiresAt: this.now() + CODE_TTL_MS,
    });
    return { requestId, clientName: client.client_name, scope, resource: this.resource };
  }

  approveAuthorization(requestId: string): string {
    const pending = this.takePending(requestId);
    const code = opaque();
    this.codes.set(code, { ...pending, used: false });
    const redirect = new URL(pending.redirectUri);
    redirect.searchParams.set("code", code);
    if (pending.state) redirect.searchParams.set("state", pending.state);
    return redirect.toString();
  }

  denyAuthorization(requestId: string): string {
    const pending = this.takePending(requestId);
    const redirect = new URL(pending.redirectUri);
    redirect.searchParams.set("error", "access_denied");
    if (pending.state) redirect.searchParams.set("state", pending.state);
    return redirect.toString();
  }

  exchangeAuthorizationCode(params: URLSearchParams | Record<string, unknown>): Record<string, unknown> {
    if (readParam(params, "grant_type") !== "authorization_code") {
      throw new OAuthProtocolError("unsupported_grant_type", "grant_type must be authorization_code");
    }
    const codeValue = requireString(readParam(params, "code"), "code");
    const grant = this.codes.get(codeValue);
    if (!grant || grant.used || grant.expiresAt <= this.now()) {
      this.codes.delete(codeValue);
      throw new OAuthProtocolError("invalid_grant", "authorization code is invalid, expired, or already used");
    }
    grant.used = true;
    this.codes.delete(codeValue);
    const clientId = requireString(readParam(params, "client_id"), "client_id");
    const redirectUri = requireString(readParam(params, "redirect_uri"), "redirect_uri");
    const resource = requireString(readParam(params, "resource"), "resource");
    const verifier = requireString(readParam(params, "code_verifier"), "code_verifier");
    if (
      clientId !== grant.clientId ||
      redirectUri !== grant.redirectUri ||
      resource !== grant.resource ||
      !PKCE_VALUE.test(verifier) ||
      !safeEqual(sha256Base64Url(verifier), grant.codeChallenge)
    ) {
      throw new OAuthProtocolError("invalid_grant", "authorization code binding or PKCE verification failed");
    }
    const token = opaque(32);
    const expiresAt = this.now() + TOKEN_TTL_MS;
    this.tokens.set(token, {
      clientId: grant.clientId,
      resource: grant.resource,
      scope: grant.scope,
      expiresAt,
    });
    return {
      access_token: token,
      token_type: "Bearer",
      expires_in: Math.floor(TOKEN_TTL_MS / 1000),
      scope: grant.scope,
    };
  }

  validateAccessToken(token: string | undefined, resource = this.resource, requiredScope = MCP_OAUTH_SCOPE): TokenValidation {
    if (!token) return { ok: false, reason: "missing" };
    const grant = this.tokens.get(token);
    if (!grant) return { ok: false, reason: "invalid" };
    if (grant.expiresAt <= this.now()) {
      this.tokens.delete(token);
      return { ok: false, reason: "expired" };
    }
    if (resource !== grant.resource) {
      return { ok: false, reason: "wrong_audience" };
    }
    if (!grant.scope.split(/\s+/).includes(requiredScope)) {
      return { ok: false, reason: "insufficient_scope" };
    }
    return { ok: true, ...grant };
  }

  private takePending(requestId: string): PendingAuthorization {
    const pending = this.pending.get(requestId);
    this.pending.delete(requestId);
    if (!pending || pending.expiresAt <= this.now()) {
      throw new OAuthProtocolError("invalid_request", "authorization request is invalid or expired");
    }
    return pending;
  }
}

export function extractBearerToken(header: string | string[] | undefined): string | undefined {
  if (typeof header !== "string") return undefined;
  const match = /^Bearer ([A-Za-z0-9._~-]+)$/i.exec(header.trim());
  return match?.[1];
}
