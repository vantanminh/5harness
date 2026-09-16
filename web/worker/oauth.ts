import {
  AuthorizationError,
  getOAuthApi,
  OAuthProvider,
  type AuthRequest,
  type OAuthHelpers,
  type OAuthProviderOptions,
} from "@cloudflare/workers-oauth-provider";

import { getBearerToken, verifyFirebaseIdToken } from "./auth";
import { errorJson, json, withCors } from "./cors";
import { ApiError } from "./errors";
import { refreshFirebaseIdToken } from "./firestore";
import { consumeDailyQuota, consumeRateLimit } from "./limits";
import { mcpApiHandler, MCP_ROUTE } from "./mcp";
import {
  CLIENT_ID,
  isValidCodeChallenge,
  isValidRedirectUri,
  isValidState,
  SYNC_READ_SCOPE,
  SYNC_WRITE_SCOPE,
} from "./protocol";
import type { Env, HarnessOAuthProps } from "./types";

const AUTHORIZE_ROUTE = "/authorize";
const TOKEN_ROUTE = "/oauth/token";
const REGISTER_ROUTE = "/oauth/register";
const AUTHORIZATION_SERVER_METADATA_ROUTE = "/.well-known/oauth-authorization-server";
const PROTECTED_RESOURCE_METADATA_ROUTE = "/.well-known/oauth-protected-resource";
const CLIENT_ALIAS_KEY = "config:harness-cli-client";
const CSRF_COOKIE = "__Host-harness-oauth-csrf";
const CSRF_TTL_SECONDS = 600;
const ACCESS_TOKEN_TTL = 15 * 60;
const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60;

function clientDisplayName(name?: string): string {
  const value = name?.trim();
  return value ? value.slice(0, 100) : "Harness client";
}

function cookieValue(request: Request, name: string): string | null {
  for (const item of (request.headers.get("Cookie") ?? "").split(";")) {
    const separator = item.indexOf("=");
    if (separator >= 0 && item.slice(0, separator).trim() === name) {
      return item.slice(separator + 1).trim() || null;
    }
  }
  return null;
}

function csrfCookie(token: string, maxAge: number): string {
  return (
    CSRF_COOKIE +
    "=" +
    token +
    "; HttpOnly; Secure; Path=/; SameSite=Lax; Max-Age=" +
    maxAge
  );
}

function withSetCookie(response: Response, value: string): Response {
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function clearCsrfCookie(response: Response): Response {
  return withSetCookie(response, csrfCookie("", 0));
}

function oauthErrorRedirect(
  redirectUri: string,
  code: string,
  description: string,
  state?: string,
  issuer?: string,
): Response {
  const redirect = new URL(redirectUri);
  redirect.searchParams.set("error", code);
  redirect.searchParams.set("error_description", description);
  if (state) redirect.searchParams.set("state", state);
  if (issuer) redirect.searchParams.set("iss", issuer);
  return Response.redirect(redirect.toString(), 302);
}

function authorizationValidationError(error: unknown): Response {
  if (!(error instanceof AuthorizationError)) throw error;
  if (!error.redirectUri) {
    return new Response(error.description, {
      status: 400,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }
  return oauthErrorRedirect(
    error.redirectUri,
    error.code,
    error.description,
    error.state,
    error.issuer,
  );
}

function consentRedirect(
  request: Request,
  name: string,
  error?: string,
  csrfToken?: string,
): Response {
  const login = new URL(AUTHORIZE_ROUTE, request.url);
  login.searchParams.set("oauth", new URL(request.url).searchParams.toString());
  login.searchParams.set("oauth_client", clientDisplayName(name));
  if (error) login.searchParams.set("oauth_error", error);
  if (csrfToken) login.searchParams.set("oauth_csrf", csrfToken);
  return Response.redirect(login.toString(), 302);
}

function formText(form: FormData, name: string, maxLength: number): string | null {
  const value = form.get(name);
  return typeof value === "string" && value.length > 0 && value.length <= maxLength
    ? value
    : null;
}

function unsupportedScopes(request: AuthRequest): boolean {
  return request.scope.some(
    (scope) =>
      scope !== SYNC_READ_SCOPE &&
      scope !== SYNC_WRITE_SCOPE &&
      scope !== "offline_access",
  );
}

export const defaultHandler = {
  async fetch(request: Request, env: Env): Promise<Response> {
    let oauthRequest: AuthRequest;
    try {
      oauthRequest = await env.OAUTH_PROVIDER!.parseAuthRequest(request);
    } catch (error) {
      return authorizationValidationError(error);
    }
    const client = await env.OAUTH_PROVIDER!.lookupClient(oauthRequest.clientId);
    if (!client) {
      return new Response("Unknown OAuth client", {
        status: 400,
        headers: { "Cache-Control": "no-store" },
      });
    }
    const displayName = clientDisplayName(client.clientName);
    if (unsupportedScopes(oauthRequest)) {
      return oauthErrorRedirect(
        oauthRequest.redirectUri,
        "invalid_scope",
        "Harness Cloud does not support one of the requested scopes.",
        oauthRequest.state,
        oauthRequest.issuer,
      );
    }
    if (request.method === "GET") {
      const csrfToken = crypto.randomUUID();
      return withSetCookie(
        consentRedirect(request, displayName, undefined, csrfToken),
        csrfCookie(csrfToken, CSRF_TTL_SECONDS),
      );
    }
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET, POST", "Cache-Control": "no-store" },
      });
    }
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return new Response("Invalid authorization form", { status: 400 });
    }
    const csrf = formText(form, "csrf_token", 128);
    if (!csrf || csrf !== cookieValue(request, CSRF_COOKIE)) {
      return new Response("Authorization request expired or invalid.", { status: 403 });
    }
    const firebaseIdToken = formText(form, "firebase_id_token", 8192);
    const firebaseRefreshToken = formText(form, "firebase_refresh_token", 8192);
    if (!firebaseIdToken || !firebaseRefreshToken) {
      return withSetCookie(
        consentRedirect(request, displayName, "Sign in before granting access.", csrf),
        csrfCookie(csrf, CSRF_TTL_SECONDS),
      );
    }
    try {
      const result = await completeFirebaseAuthorization(
        oauthRequest,
        firebaseIdToken,
        firebaseRefreshToken,
        env,
        env.OAUTH_PROVIDER!,
      );
      return clearCsrfCookie(Response.redirect(result.redirectTo, 302));
    } catch {
      console.error("Harness OAuth authorization failed");
      return withSetCookie(
        consentRedirect(request, displayName, "Could not verify the Firebase session.", csrf),
        csrfCookie(csrf, CSRF_TTL_SECONDS),
      );
    }
  },
};

export const oauthOptions: OAuthProviderOptions<Env> = {
  apiRoute: MCP_ROUTE,
  apiHandler: mcpApiHandler,
  defaultHandler,
  authorizeEndpoint: AUTHORIZE_ROUTE,
  tokenEndpoint: TOKEN_ROUTE,
  clientRegistrationEndpoint: REGISTER_ROUTE,
  scopesSupported: [SYNC_READ_SCOPE, SYNC_WRITE_SCOPE, "offline_access"],
  resourceMetadata: {
    scopes_supported: [SYNC_READ_SCOPE, SYNC_WRITE_SCOPE],
    resource_name: "Harness Cloud encrypted sync",
  },
  accessTokenTTL: ACCESS_TOKEN_TTL,
  refreshTokenTTL: REFRESH_TOKEN_TTL,
};

export const oauthProvider = new OAuthProvider<Env>(oauthOptions);

export function getOAuthHelpers(env: Env): OAuthHelpers {
  return env.OAUTH_PROVIDER ?? getOAuthApi(oauthOptions, env);
}

/** Registers the stable CLI alias once while keeping the provider's random client id private. */
export async function harnessClientId(env: Env): Promise<string> {
  const helpers = getOAuthHelpers(env);
  const stored = await env.OAUTH_KV.get(CLIENT_ALIAS_KEY);
  if (stored && (await helpers.lookupClient(stored))) return stored;
  const client = await helpers.createClient({
    redirectUris: [
      "http://127.0.0.1/callback",
      "http://localhost/callback",
      "http://[::1]/callback",
    ],
    clientName: "5harness CLI",
    tokenEndpointAuthMethod: "none",
  });
  await env.OAUTH_KV.put(CLIENT_ALIAS_KEY, client.clientId);
  return client.clientId;
}

async function canonicalClientId(env: Env, requested: unknown): Promise<string> {
  if (typeof requested !== "string" || requested.length === 0 || requested.length > 512) {
    throw new ApiError(400, "invalid_client", "OAuth client id is invalid.");
  }
  if (requested === CLIENT_ID) return harnessClientId(env);
  const client = await getOAuthHelpers(env).lookupClient(requested);
  if (!client) throw new ApiError(400, "invalid_client", "OAuth client id is invalid.");
  return requested;
}

function requestWithClientId(request: Request, clientId: string): Request {
  const url = new URL(request.url);
  if (url.searchParams.get("client_id") === CLIENT_ID) {
    url.searchParams.set("client_id", clientId);
  }
  return new Request(url.toString(), request);
}

async function completeFirebaseAuthorization(
  oauthRequest: AuthRequest,
  firebaseIdToken: string,
  firebaseRefreshToken: string,
  env: Env,
  helpers: OAuthHelpers,
): Promise<{ redirectTo: string }> {
  if (!env.FIREBASE_API_KEY) {
    throw new ApiError(500, "service_misconfigured", "Firebase Web API key is not configured.");
  }
  const signedIn = await verifyFirebaseIdToken(firebaseIdToken, env);
  const refreshedIdToken = await refreshFirebaseIdToken(
    firebaseRefreshToken,
    env.FIREBASE_API_KEY,
  );
  const refreshed = await verifyFirebaseIdToken(refreshedIdToken, env);
  if (signedIn.uid !== refreshed.uid) {
    throw new ApiError(401, "unauthenticated", "Firebase sessions belong to different accounts.");
  }
  const scope = oauthRequest.scope.filter(
    (value) =>
      value === SYNC_READ_SCOPE ||
      value === SYNC_WRITE_SCOPE ||
      value === "offline_access",
  );
  if (!scope.includes(SYNC_READ_SCOPE)) {
    throw new ApiError(400, "invalid_scope", "sync:read is required.");
  }
  await consumeDailyQuota(env, signedIn.uid, "oauthCodes", 1, 20);
  const props: HarnessOAuthProps = {
    uid: signedIn.uid,
    projectId: env.FIREBASE_PROJECT_ID,
    firebaseApiKey: env.FIREBASE_API_KEY,
    firebaseRefreshToken,
    firestoreApiBaseUrl: env.FIRESTORE_API_BASE_URL,
  };
  return helpers.completeAuthorization({
    request: oauthRequest,
    userId: signedIn.uid,
    metadata: { clientName: "Harness Cloud" },
    scope,
    props,
  });
}

async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (contentLength > 950_000) {
    throw new ApiError(413, "payload_too_large", "Request body is too large.");
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > 950_000) {
    throw new ApiError(413, "payload_too_large", "Request body is too large.");
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ApiError(400, "invalid_json", "Request body must be valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ApiError(400, "invalid_json", "Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

export async function handleCompatAuthorize(request: Request, env: Env): Promise<Response> {
  await consumeRateLimit(request, env, "oauth-authorize", 30);
  const body = await readJsonObject(request);
  const csrf = typeof body.csrf_token === "string" ? body.csrf_token : "";
  if (!csrf || csrf !== cookieValue(request, CSRF_COOKIE)) {
    throw new ApiError(403, "csrf_invalid", "Authorization request expired or invalid.");
  }
  const requestedClientId = body.client_id;
  const requestedRedirectUri = body.redirect_uri;
  const requestedScope = typeof body.scope === "string"
    ? body.scope.trim().split(/\s+/).filter(Boolean)
    : [];
  if (
    body.response_type !== "code" ||
    typeof requestedClientId !== "string" ||
    requestedClientId.length === 0 ||
    requestedClientId.length > 512 ||
    typeof requestedRedirectUri !== "string" ||
    requestedRedirectUri.length === 0 ||
    requestedRedirectUri.length > 2048 ||
    body.code_challenge_method !== "S256" ||
    !isValidCodeChallenge(body.code_challenge) ||
    requestedScope.length === 0 ||
    !requestedScope.includes(SYNC_READ_SCOPE) ||
    requestedScope.some(
      (scope) =>
        scope !== SYNC_READ_SCOPE &&
        scope !== SYNC_WRITE_SCOPE &&
        scope !== "offline_access",
    ) ||
    !isValidState(body.state) ||
    (requestedClientId === CLIENT_ID && !isValidRedirectUri(requestedRedirectUri))
  ) {
    throw new ApiError(400, "invalid_request", "OAuth authorization request is invalid.");
  }
  const clientId = await canonicalClientId(env, requestedClientId);
  const requestUrl = new URL(AUTHORIZE_ROUTE, request.url);
  for (const field of [
    "redirect_uri",
    "response_type",
    "code_challenge",
    "code_challenge_method",
    "scope",
    "state",
  ]) {
    requestUrl.searchParams.set(field, String(body[field]));
  }
  if (typeof body.resource === "string" && body.resource.length <= 2048) {
    requestUrl.searchParams.set("resource", body.resource);
  }
  requestUrl.searchParams.set("client_id", clientId);
  const helpers = getOAuthHelpers(env);
  let oauthRequest: AuthRequest;
  try {
    oauthRequest = await helpers.parseAuthRequest(new Request(requestUrl));
  } catch {
    throw new ApiError(400, "invalid_request", "OAuth authorization request is invalid.");
  }
  const firebaseIdToken = getBearerToken(request);
  const firebaseRefreshToken = body.firebase_refresh_token;
  if (typeof firebaseRefreshToken !== "string" || firebaseRefreshToken.length > 8192) {
    throw new ApiError(401, "unauthenticated", "Firebase refresh credential is required.");
  }
  const result = await completeFirebaseAuthorization(
    oauthRequest,
    firebaseIdToken,
    firebaseRefreshToken,
    env,
    helpers,
  );
  const callback = new URL(result.redirectTo);
  const code = callback.searchParams.get("code");
  if (!code) throw new ApiError(500, "oauth_failed", "OAuth authorization code was not created.");
  const response = json(request, env, {
    redirect_uri: oauthRequest.redirectUri,
    code,
    state: callback.searchParams.get("state") ?? oauthRequest.state,
    iss: callback.searchParams.get("iss") ?? undefined,
  });
  return clearCsrfCookie(response);
}

async function forwardForm(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  pathname: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const clientId = await canonicalClientId(env, body.client_id);
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...body, client_id: clientId })) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      form.set(key, String(value));
    }
  }
  const headers = new Headers({ "Content-Type": "application/x-www-form-urlencoded" });
  const origin = request.headers.get("Origin");
  if (origin) headers.set("Origin", origin);
  const forwarded = new Request(new URL(pathname, request.url), {
    method: "POST",
    headers,
    body: form,
  });
  return withCors(request, env, await oauthProvider.fetch(forwarded, env, ctx));
}

export async function handleCompatToken(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  await consumeRateLimit(request, env, "oauth-token", 60);
  return forwardForm(request, env, ctx, TOKEN_ROUTE, await readJsonObject(request));
}

export async function handleCompatRevoke(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  await consumeRateLimit(request, env, "oauth-revoke", 30);
  const body = await readJsonObject(request);
  return forwardForm(request, env, ctx, TOKEN_ROUTE, {
    client_id: body.client_id,
    token: body.refresh_token ?? body.access_token,
    token_type_hint: "refresh_token",
  });
}

export async function handleCompatRevokeAll(
  request: Request,
  env: Env,
): Promise<Response> {
  await consumeRateLimit(request, env, "oauth-revoke-all", 10);
  const token = getBearerToken(request);
  const user = await verifyFirebaseIdToken(token, env);
  const canonical = await harnessClientId(env);
  const helpers = getOAuthHelpers(env);
  let cursor: string | undefined;
  do {
    const page = await helpers.listUserGrants(user.uid, { limit: 1000, cursor });
    await Promise.all(
      page.items
        .filter((grant) => grant.clientId === canonical)
        .map((grant) => helpers.revokeGrant(grant.id, user.uid)),
    );
    cursor = page.cursor;
  } while (cursor);
  return withCors(request, env, new Response(null, { status: 204 }));
}

export function isOAuthRoute(pathname: string): boolean {
  return (
    pathname === AUTHORIZE_ROUTE ||
    pathname === TOKEN_ROUTE ||
    pathname === REGISTER_ROUTE ||
    pathname === MCP_ROUTE ||
    pathname === AUTHORIZATION_SERVER_METADATA_ROUTE ||
    pathname === PROTECTED_RESOURCE_METADATA_ROUTE ||
    pathname.startsWith(PROTECTED_RESOURCE_METADATA_ROUTE + "/")
  );
}

export async function handleOAuthRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const rewritten =
    new URL(request.url).pathname === AUTHORIZE_ROUTE
      ? requestWithClientId(request, await harnessClientId(env))
      : request;
  try {
    return await oauthProvider.fetch(rewritten, env, ctx);
  } catch (error) {
    console.error("Harness OAuth provider request failed", error instanceof Error ? error.name : "unknown");
    return errorJson(request, env, "oauth_unavailable", "Harness OAuth is temporarily unavailable.", 503);
  }
}

export async function purgeOAuthData(env: Env): Promise<void> {
  await oauthProvider.purgeExpiredData(env, { batchSize: 50 });
}
