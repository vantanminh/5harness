/**
 * Firebase ID-token verification for Cloudflare Workers.
 *
 * This is the same trust boundary used by StudyOS: Google publishes the
 * signing keys, and Web Crypto verifies the RS256 signature without
 * firebase-admin, a service account, or Firebase Functions.
 */

import type { AuthUser, Env } from "./types";

const JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const JWKS_TTL_MS = 60 * 60 * 1000;

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
}

interface JwksCache {
  keys: Map<string, CryptoKey>;
  fetchedAt: number;
}

interface FirebaseIdTokenPayload {
  aud: string;
  iss: string;
  sub: string;
  exp: number;
  iat: number;
  email?: string;
  email_verified?: boolean;
  firebase?: { sign_in_provider?: string };
}

let jwksCache: JwksCache | null = null;

function b64urlToBytes(input: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(input)) throw new Error("Invalid base64url");
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
  const binary = atob(padded + pad);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJsonPart<T>(part: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(part))) as T;
}

function asArrayBuffer(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}

async function getCryptoKey(kid: string): Promise<CryptoKey | null> {
  const now = Date.now();
  if (!jwksCache || now - jwksCache.fetchedAt > JWKS_TTL_MS) {
    const response = await fetch(JWKS_URL, {
      cf: { cacheTtl: 3600, cacheEverything: true },
    });
    if (!response.ok) throw new AuthError("Unable to load Firebase signing keys.", 503);
    const payload = (await response.json()) as { keys?: Jwk[] };
    const keys = new Map<string, CryptoKey>();
    for (const jwk of payload.keys ?? []) {
      const key = await crypto.subtle.importKey(
        "jwk",
        { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      );
      keys.set(jwk.kid, key);
    }
    jwksCache = { keys, fetchedAt: now };
  }
  return jwksCache.keys.get(kid) ?? null;
}

export async function verifyFirebaseIdToken(
  token: string,
  env: Pick<Env, "FIREBASE_PROJECT_ID">,
): Promise<AuthUser> {
  const projectId = env.FIREBASE_PROJECT_ID?.trim();
  if (!projectId) throw new AuthError("Firebase project is not configured.", 500);
  if (!token || token.length > 8192) throw new AuthError("Invalid Firebase token.", 401);

  const parts = token.split(".");
  if (parts.length !== 3) throw new AuthError("Invalid Firebase token.", 401);
  const headerPart = parts[0];
  const payloadPart = parts[1];
  const signaturePart = parts[2];

  let header: { alg?: string; kid?: string };
  let payload: FirebaseIdTokenPayload;
  try {
    header = decodeJsonPart<{ alg?: string; kid?: string }>(headerPart);
    payload = decodeJsonPart<FirebaseIdTokenPayload>(payloadPart);
  } catch {
    throw new AuthError("Invalid Firebase token.", 401);
  }
  if (header.alg !== "RS256" || !header.kid) {
    throw new AuthError("Unsupported Firebase token algorithm.", 401);
  }

  let key = await getCryptoKey(header.kid);
  if (!key) {
    jwksCache = null;
    key = await getCryptoKey(header.kid);
  }
  if (!key) throw new AuthError("Firebase signing key was not found.", 401);

  let signature: Uint8Array;
  try {
    signature = b64urlToBytes(signaturePart);
  } catch {
    throw new AuthError("Invalid Firebase token.", 401);
  }
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    asArrayBuffer(signature),
    new TextEncoder().encode(headerPart + "." + payloadPart),
  );
  if (!valid) throw new AuthError("Invalid Firebase token signature.", 401);

  const now = Math.floor(Date.now() / 1000);
  if (
    typeof payload.aud !== "string" ||
    typeof payload.iss !== "string" ||
    typeof payload.sub !== "string" ||
    payload.sub.length === 0 ||
    payload.sub.length > 128 ||
    !Number.isFinite(payload.exp) ||
    !Number.isFinite(payload.iat)
  ) {
    throw new AuthError("Invalid Firebase token claims.", 401);
  }
  if (payload.exp <= now) throw new AuthError("Firebase token has expired.", 401);
  if (payload.iat > now + 60) throw new AuthError("Firebase token is not active yet.", 401);
  if (payload.aud !== projectId) throw new AuthError("Firebase token belongs to another project.", 401);
  if (payload.iss !== "https://securetoken.google.com/" + projectId) {
    throw new AuthError("Firebase token issuer is invalid.", 401);
  }
  if (payload.firebase?.sign_in_provider === "anonymous") {
    throw new AuthError("Anonymous Firebase accounts are not allowed.", 403);
  }

  return {
    uid: payload.sub,
    email: payload.email,
    emailVerified: payload.email_verified,
  };
}

export class AuthError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

export function getBearerToken(request: Request): string {
  const value = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+([A-Za-z0-9._~+/=-]{20,8192})$/i.exec(value);
  if (!match?.[1]) throw new AuthError("Firebase authentication is required.", 401);
  return match[1];
}

export async function requireFirebaseUser(
  request: Request,
  env: Env,
): Promise<{ user: AuthUser; token: string }> {
  const token = getBearerToken(request);
  return { user: await verifyFirebaseIdToken(token, env), token };
}
