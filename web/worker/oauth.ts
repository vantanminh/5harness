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
  randomOpaque,
  SYNC_READ_SCOPE,
  SYNC_WRITE_SCOPE,
} from "./protocol";
import type { Env, HarnessOAuthProps } from "./types";

const AUTHORIZE_ROUTE = "/authorize";
const TOKEN_ROUTE = "/oauth/token";
export const DEVICE_CODE_ROUTE = "/oauth/device/code";
export const DEVICE_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:device_code";
export const DEVICE_VERIFY_ROUTE = "/device";
export const DEVICE_CSRF_ROUTE = "/api/oauth/device/csrf";
export const DEVICE_APPROVE_ROUTE = "/api/oauth/device/approve";
const REGISTER_ROUTE = "/oauth/register";
const AUTHORIZATION_SERVER_METADATA_ROUTE = "/.well-known/oauth-authorization-server";
const PROTECTED_RESOURCE_METADATA_ROUTE = "/.well-known/oauth-protected-resource";
const CLIENT_ALIAS_KEY = "config:harness-cli-client";
const CSRF_COOKIE = "__Host-harness-oauth-csrf";
const DEVICE_CSRF_COOKIE = "__Host-harness-device-csrf";
const DEVICE_KEY_PREFIX = "oauth:device:";
const DEVICE_USER_KEY_PREFIX = "oauth:device-user:";
const DEVICE_POLL_KEY_PREFIX = "oauth:device-poll:";
const DEVICE_TTL_SECONDS = 10 * 60;
const DEVICE_POLL_INTERVAL_SECONDS = 5;
const DEVICE_INTERNAL_REDIRECT_URI = "http://127.0.0.1/callback";
const DEVICE_USER_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CSRF_TTL_SECONDS = 600;
const ACCESS_TOKEN_TTL = 15 * 60;
const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60;

type DeviceCodeRecord = {
  deviceCodeHash: string;
  userCodeHash: string;
  clientId: string;
  scope: string[];
  codeChallenge: string;
  codeChallengeMethod: "S256";
  status: "pending" | "approved";
  authCode?: string;
  createdAt: number;
  expiresAt: number;
  interval: number;
};

type DevicePollState = {
  lastPollAt: number;
  interval: number;
};

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

function deviceCsrfCookie(token: string, maxAge: number): string {
  return (
    DEVICE_CSRF_COOKIE +
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

function clearDeviceCsrfCookie(response: Response): Response {
  return withSetCookie(response, deviceCsrfCookie("", 0));
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

function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function pkceChallenge(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function deviceKey(deviceCodeHash: string): string {
  return DEVICE_KEY_PREFIX + deviceCodeHash;
}

function deviceUserKey(userCodeHash: string): string {
  return DEVICE_USER_KEY_PREFIX + userCodeHash;
}

function devicePollKey(deviceCodeHash: string): string {
  return DEVICE_POLL_KEY_PREFIX + deviceCodeHash;
}

function deviceHintRequest(deviceCodeHash: string): Request {
  return new Request("https://harness.internal/oauth/device-hint/" + deviceCodeHash);
}

function edgeCache(): Cache | null {
  const storage = caches as CacheStorage & { default?: Cache };
  return storage.default ?? null;
}

function normalizeUserCode(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 32) return null;
  const normalized = value.replace(/[\s-]/g, "").toUpperCase();
  if (
    normalized.length !== 8 ||
    !new RegExp("^[" + DEVICE_USER_CODE_ALPHABET + "]{8}$").test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function displayUserCode(value: string): string {
  return value.slice(0, 4) + "-" + value.slice(4);
}

function validCodeVerifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._~-]{43,128}$/.test(value);
}

function requestedScopes(value: unknown): string[] | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) return null;
  const scopes = value.trim().split(/\s+/).filter(Boolean);
  if (
    scopes.length === 0 ||
    !scopes.includes(SYNC_READ_SCOPE) ||
    scopes.some(
      (scope) =>
        scope !== SYNC_READ_SCOPE &&
        scope !== SYNC_WRITE_SCOPE &&
        scope !== "offline_access",
    )
  ) {
    return null;
  }
  return [...new Set(scopes)];
}

function randomUserCode(): string {
  const bytes = new Uint8Array(16);
  const limit = 256 - (256 % DEVICE_USER_CODE_ALPHABET.length);
  let raw = "";
  while (raw.length < 8) {
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= limit) continue;
      raw += DEVICE_USER_CODE_ALPHABET[byte % DEVICE_USER_CODE_ALPHABET.length];
      if (raw.length === 8) break;
    }
  }
  return displayUserCode(raw);
}

function retryResponse(
  request: Request,
  env: Env,
  error: string,
  message: string,
  retryAfter?: number,
): Response {
  const response = errorJson(request, env, error, message, 400);
  if (retryAfter === undefined) return response;
  const headers = new Headers(response.headers);
  headers.set("Retry-After", String(Math.max(1, Math.floor(retryAfter))));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
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

function isDeviceRecord(value: unknown): value is DeviceCodeRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as DeviceCodeRecord;
  return typeof record.deviceCodeHash === "string" && typeof record.userCodeHash === "string";
}

async function loadDeviceRecord(
  env: Env,
  deviceCodeHash: string,
): Promise<DeviceCodeRecord | null> {
  const value = await env.OAUTH_KV.get(deviceKey(deviceCodeHash), { type: "json" });
  return isDeviceRecord(value) ? value : null;
}

async function rememberApprovedDevice(record: DeviceCodeRecord): Promise<void> {
  if (record.status !== "approved" || !record.authCode) return;
  const cache = edgeCache();
  if (!cache) return;
  try {
    await cache.put(
      deviceHintRequest(record.deviceCodeHash),
      new Response(JSON.stringify(record), {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "max-age=" + DEVICE_TTL_SECONDS,
        },
      }),
    );
  } catch {
    // The Cache API is a same-colo accelerator; KV remains the source of truth.
  }
}

async function forgetApprovedDevice(deviceCodeHash: string): Promise<void> {
  const cache = edgeCache();
  if (!cache) return;
  try {
    await cache.delete(deviceHintRequest(deviceCodeHash));
  } catch {
    // ignore
  }
}

async function approvedDeviceHint(deviceCodeHash: string): Promise<DeviceCodeRecord | null> {
  const cache = edgeCache();
  if (!cache) return null;
  try {
    const cached = await cache.match(deviceHintRequest(deviceCodeHash));
    if (!cached) return null;
    const value: unknown = await cached.json();
    if (!isDeviceRecord(value) || value.status !== "approved" || !value.authCode) return null;
    return value;
  } catch {
    return null;
  }
}

async function loadDeviceRecordForPoll(
  env: Env,
  deviceCodeHash: string,
): Promise<DeviceCodeRecord | null> {
  const hinted = await approvedDeviceHint(deviceCodeHash);
  if (hinted) return hinted;
  return loadDeviceRecord(env, deviceCodeHash);
}

async function loadPollState(env: Env, deviceCodeHash: string): Promise<DevicePollState | null> {
  const value = await env.OAUTH_KV.get(devicePollKey(deviceCodeHash), { type: "json" });
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const state = value as DevicePollState;
  if (!Number.isFinite(state.lastPollAt) || !Number.isFinite(state.interval)) return null;
  return { lastPollAt: state.lastPollAt, interval: state.interval };
}

async function savePollState(
  env: Env,
  record: DeviceCodeRecord,
  state: DevicePollState,
): Promise<void> {
  await env.OAUTH_KV.put(devicePollKey(record.deviceCodeHash), JSON.stringify(state), {
    expirationTtl: Math.max(1, record.expiresAt - unixNow()),
  });
}

async function deleteDeviceRecord(env: Env, record: DeviceCodeRecord): Promise<void> {
  await Promise.all([
    env.OAUTH_KV.delete(deviceKey(record.deviceCodeHash)),
    env.OAUTH_KV.delete(deviceUserKey(record.userCodeHash)),
    env.OAUTH_KV.delete(devicePollKey(record.deviceCodeHash)),
    forgetApprovedDevice(record.deviceCodeHash),
  ]);
}

/** Starts an RFC 8628-style device authorization transaction for the CLI. */
export async function handleDeviceCode(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return withCors(
      request,
      env,
      new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "POST", "Cache-Control": "no-store" },
      }),
    );
  }
  await consumeRateLimit(request, env, "oauth-device-code", 20);
  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (contentLength > 16_384) {
    throw new ApiError(413, "payload_too_large", "Request body is too large.");
  }
  const contentType = request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") {
    throw new ApiError(
      400,
      "invalid_request",
      "Content-Type must be application/x-www-form-urlencoded.",
    );
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new ApiError(400, "invalid_request", "Request body must be valid form data.");
  }
  const codeChallenge = formText(form, "code_challenge", 128);
  const scope = requestedScopes(formText(form, "scope", 512));
  if (
    !codeChallenge ||
    !isValidCodeChallenge(codeChallenge) ||
    form.get("code_challenge_method") !== "S256" ||
    !scope
  ) {
    throw new ApiError(400, "invalid_request", "Device authorization request is invalid.");
  }
  const clientId = await canonicalClientId(env, formText(form, "client_id", 512));
  const now = unixNow();
  let deviceCode = "";
  let userCode = "";
  let deviceCodeHash = "";
  let userCodeHash = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    deviceCode = randomOpaque(32);
    userCode = randomUserCode();
    deviceCodeHash = await sha256Hex(deviceCode);
    userCodeHash = await sha256Hex(userCode.replace("-", ""));
    const existing = await env.OAUTH_KV.get(deviceUserKey(userCodeHash));
    if (!existing) break;
    if (attempt === 2) {
      throw new ApiError(503, "oauth_unavailable", "Could not allocate a device code. Try again.");
    }
  }
  const record: DeviceCodeRecord = {
    deviceCodeHash,
    userCodeHash,
    clientId,
    scope,
    codeChallenge,
    codeChallengeMethod: "S256",
    status: "pending",
    createdAt: now,
    expiresAt: now + DEVICE_TTL_SECONDS,
    interval: DEVICE_POLL_INTERVAL_SECONDS,
  };
  await env.OAUTH_KV.put(deviceKey(deviceCodeHash), JSON.stringify(record), {
    expirationTtl: DEVICE_TTL_SECONDS,
  });
  await env.OAUTH_KV.put(deviceUserKey(userCodeHash), deviceCodeHash, {
    expirationTtl: DEVICE_TTL_SECONDS,
  });
  const verificationUri = new URL(DEVICE_VERIFY_ROUTE, request.url);
  const complete = new URL(verificationUri);
  complete.searchParams.set("user_code", userCode);
  return json(request, env, {
    device_code: deviceCode,
    user_code: userCode,
    verification_uri: verificationUri.toString(),
    verification_uri_complete: complete.toString(),
    expires_in: DEVICE_TTL_SECONDS,
    interval: DEVICE_POLL_INTERVAL_SECONDS,
  });
}

export async function handleDeviceToken(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  await consumeRateLimit(request, env, "oauth-device-token", 120);
  const contentLength = Number(request.headers.get("Content-Length") ?? "0");
  if (contentLength > 16_384) {
    throw new ApiError(413, "payload_too_large", "Request body is too large.");
  }
  const contentType = request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/x-www-form-urlencoded") {
    throw new ApiError(
      400,
      "invalid_request",
      "Content-Type must be application/x-www-form-urlencoded.",
    );
  }
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new ApiError(400, "invalid_request", "Request body must be valid form data.");
  }
  const deviceCode = formText(form, "device_code", 512);
  const verifier = formText(form, "code_verifier", 128);
  if (!deviceCode || !validCodeVerifier(verifier)) {
    throw new ApiError(400, "invalid_request", "Device token request is invalid.");
  }
  const clientId = await canonicalClientId(env, formText(form, "client_id", 512));
  const deviceCodeHash = await sha256Hex(deviceCode);
  const record = await loadDeviceRecordForPoll(env, deviceCodeHash);
  if (!record || record.clientId !== clientId) {
    return retryResponse(request, env, "invalid_grant", "Device code is invalid or expired.");
  }
  const now = unixNow();
  if (record.expiresAt <= now) {
    await deleteDeviceRecord(env, record);
    return retryResponse(request, env, "expired_token", "Device code has expired.");
  }
  if (record.codeChallenge !== (await pkceChallenge(verifier))) {
    return retryResponse(request, env, "invalid_grant", "Device code verifier is invalid.");
  }
  if (record.status === "approved" && record.authCode) {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: record.clientId,
      redirect_uri: DEVICE_INTERNAL_REDIRECT_URI,
      code: record.authCode,
      code_verifier: verifier,
    });
    const headers = new Headers({ "Content-Type": "application/x-www-form-urlencoded" });
    const origin = request.headers.get("Origin");
    if (origin) headers.set("Origin", origin);
    const forwarded = new Request(new URL(TOKEN_ROUTE, request.url), {
      method: "POST",
      headers,
      body,
    });
    const response = await oauthProvider.fetch(forwarded, env, ctx);
    if (response.ok) await deleteDeviceRecord(env, record);
    return withCors(request, env, response);
  }

  const poll = (await loadPollState(env, record.deviceCodeHash)) ?? {
    lastPollAt: 0,
    interval: record.interval || DEVICE_POLL_INTERVAL_SECONDS,
  };
  if (poll.lastPollAt > 0 && now - poll.lastPollAt < poll.interval) {
    poll.interval = Math.min(30, poll.interval + 5);
    poll.lastPollAt = now;
    await savePollState(env, record, poll);
    return retryResponse(
      request,
      env,
      "slow_down",
      "Poll interval is too short. Try again later.",
      poll.interval,
    );
  }
  poll.lastPollAt = now;
  await savePollState(env, record, poll);
  return retryResponse(
    request,
    env,
    "authorization_pending",
    "Device authorization is still pending.",
    poll.interval,
  );
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

/** Issues a short-lived HttpOnly CSRF cookie for the device approval form. */
export async function handleDeviceCsrf(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") {
    return withCors(
      request,
      env,
      new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "GET", "Cache-Control": "no-store" },
      }),
    );
  }
  await consumeRateLimit(request, env, "oauth-device-csrf", 30);
  const token = randomOpaque(24);
  return withSetCookie(
    json(request, env, { csrf_token: token }),
    deviceCsrfCookie(token, CSRF_TTL_SECONDS),
  );
}

/** Approves a pending device code using the currently signed-in Firebase user. */
export async function handleDeviceApprove(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return withCors(
      request,
      env,
      new Response("Method Not Allowed", {
        status: 405,
        headers: { Allow: "POST", "Cache-Control": "no-store" },
      }),
    );
  }
  await consumeRateLimit(request, env, "oauth-device-approve", 30);
  const body = await readJsonObject(request);
  const csrf = typeof body.csrf_token === "string" ? body.csrf_token : "";
  if (!csrf || csrf !== cookieValue(request, DEVICE_CSRF_COOKIE)) {
    throw new ApiError(403, "csrf_invalid", "Device authorization request expired or invalid.");
  }
  const normalizedUserCode = normalizeUserCode(body.user_code);
  if (!normalizedUserCode) {
    throw new ApiError(400, "invalid_request", "Enter the eight-character device code.");
  }
  const firebaseRefreshToken = body.firebase_refresh_token;
  if (typeof firebaseRefreshToken !== "string" || firebaseRefreshToken.length > 8192) {
    throw new ApiError(401, "unauthenticated", "Firebase refresh credential is required.");
  }
  const firebaseIdToken = getBearerToken(request);
  const userCodeHash = await sha256Hex(normalizedUserCode);
  const rawDeviceCodeHash = await env.OAUTH_KV.get(deviceUserKey(userCodeHash));
  if (typeof rawDeviceCodeHash !== "string" || !/^[a-f0-9]{64}$/.test(rawDeviceCodeHash)) {
    throw new ApiError(400, "invalid_grant", "Device code is invalid or expired.");
  }
  const record = await loadDeviceRecord(env, rawDeviceCodeHash);
  if (!record || record.userCodeHash !== userCodeHash) {
    throw new ApiError(400, "invalid_grant", "Device code is invalid or expired.");
  }
  if (record.expiresAt <= unixNow()) {
    await deleteDeviceRecord(env, record);
    throw new ApiError(400, "expired_token", "Device code has expired.");
  }
  if (record.status === "approved" && record.authCode) {
    return clearDeviceCsrfCookie(json(request, env, { ok: true }));
  }

  const helpers = getOAuthHelpers(env);
  const result = await completeFirebaseAuthorization(
    {
      responseType: "code",
      clientId: record.clientId,
      redirectUri: DEVICE_INTERNAL_REDIRECT_URI,
      scope: record.scope,
      state: randomOpaque(24),
      codeChallenge: record.codeChallenge,
      codeChallengeMethod: record.codeChallengeMethod,
    },
    firebaseIdToken,
    firebaseRefreshToken,
    env,
    helpers,
  );
  const callback = new URL(result.redirectTo);
  const internalRedirect = new URL(DEVICE_INTERNAL_REDIRECT_URI);
  if (callback.origin !== internalRedirect.origin || callback.pathname !== internalRedirect.pathname) {
    throw new ApiError(500, "oauth_failed", "OAuth authorization code was not created.");
  }
  const authCode = callback.searchParams.get("code");
  if (!authCode || authCode.length > 2048) {
    throw new ApiError(500, "oauth_failed", "OAuth authorization code was not created.");
  }
  record.status = "approved";
  record.authCode = authCode;
  await env.OAUTH_KV.put(deviceKey(record.deviceCodeHash), JSON.stringify(record), {
    expirationTtl: Math.max(1, record.expiresAt - unixNow()),
  });
  await rememberApprovedDevice(record);
  return clearDeviceCsrfCookie(json(request, env, { ok: true }));
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
    pathname === DEVICE_CODE_ROUTE ||
    pathname === REGISTER_ROUTE ||
    pathname === MCP_ROUTE ||
    pathname === AUTHORIZATION_SERVER_METADATA_ROUTE ||
    pathname === PROTECTED_RESOURCE_METADATA_ROUTE ||
    pathname.startsWith(PROTECTED_RESOURCE_METADATA_ROUTE + "/")
  );
}

async function isDeviceTokenRequest(request: Request): Promise<boolean> {
  if (request.method !== "POST") return false;
  try {
    const form = await request.clone().formData();
    return form.get("grant_type") === DEVICE_GRANT_TYPE;
  } catch {
    return false;
  }
}

async function metadataResponse(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const response = await oauthProvider.fetch(request, env, ctx);
  if (!response.ok) return withCors(request, env, response);
  let metadata: Record<string, unknown>;
  try {
    const value: unknown = await response.clone().json();
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return withCors(request, env, response);
    }
    metadata = value as Record<string, unknown>;
  } catch {
    return withCors(request, env, response);
  }
  const grants = Array.isArray(metadata.grant_types_supported)
    ? metadata.grant_types_supported.filter((value): value is string => typeof value === "string")
    : [];
  if (!grants.includes(DEVICE_GRANT_TYPE)) grants.push(DEVICE_GRANT_TYPE);
  metadata.grant_types_supported = grants;
  metadata.device_authorization_endpoint = new URL(DEVICE_CODE_ROUTE, request.url).toString();
  return withCors(
    request,
    env,
    new Response(JSON.stringify(metadata), {
      status: response.status,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    }),
  );
}

export async function handleOAuthRequest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const pathname = new URL(request.url).pathname;
  if (pathname === DEVICE_CODE_ROUTE) return handleDeviceCode(request, env);
  if (pathname === TOKEN_ROUTE && (await isDeviceTokenRequest(request))) {
    return handleDeviceToken(request, env, ctx);
  }
  if (pathname === AUTHORIZATION_SERVER_METADATA_ROUTE) {
    return metadataResponse(request, env, ctx);
  }
  const rewritten =
    pathname === AUTHORIZE_ROUTE
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
