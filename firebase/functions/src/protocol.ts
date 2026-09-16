import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const SYNC_SCHEMA_VERSION = 1;
export const PBKDF2_MIN_ITERATIONS = 100_000;
export const PBKDF2_MAX_ITERATIONS = 2_000_000;
export const MAX_ENVELOPE_BYTES = 900_000;
export const MAX_PROJECT_ID_LENGTH = 64;
export const CLIENT_ID = "harness-cli";
export const SUPPORTED_SCOPE = "sync:read sync:write";

export interface EncryptedEnvelope {
  schema_version: number;
  format: string;
  project_id: string;
  project_name: string;
  plaintext_sha256: string;
  kdf: string;
  iterations: number;
  salt_base64: string;
  cipher: string;
  nonce_base64: string;
  ciphertext_base64: string;
  created_at: string;
}

export interface AuthorizeRequest {
  client_id: string;
  redirect_uri: string;
  response_type: string;
  code_challenge: string;
  code_challenge_method: string;
  scope: string;
  state: string;
}

export function randomOpaque(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hashSecret(value: string): string {
  return sha256Hex("5harness-secret-v1:" + value);
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isValidProxyToken(presented: unknown, configured: unknown): boolean {
  return (
    typeof presented === "string" &&
    typeof configured === "string" &&
    configured.length >= 32 &&
    safeEqual(presented, configured)
  );
}

export function isValidProjectId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 16 &&
    value.length <= MAX_PROJECT_ID_LENGTH &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

export function isValidRedirectUri(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 300) return false;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(host)) {
      return false;
    }
    return (
      url.pathname === "/callback" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.port.length > 0 &&
      Number(url.port) >= 1 &&
      Number(url.port) <= 65535
    );
  } catch {
    return false;
  }
}

export function isValidCodeChallenge(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43,128}$/.test(value);
}

export function isValidState(value: unknown): value is string {
  return typeof value === "string" && value.length >= 16 && value.length <= 512;
}

export function validateAuthorizeRequest(body: unknown): string | null {
  if (!body || typeof body !== "object") return "invalid_request";
  const request = body as Partial<AuthorizeRequest>;
  if (request.client_id !== CLIENT_ID) return "invalid_client";
  if (request.response_type !== "code") return "unsupported_response_type";
  if (!isValidRedirectUri(request.redirect_uri)) return "invalid_redirect_uri";
  if (request.code_challenge_method !== "S256") return "invalid_code_challenge";
  if (!isValidCodeChallenge(request.code_challenge)) return "invalid_code_challenge";
  if (request.scope !== SUPPORTED_SCOPE) return "invalid_scope";
  if (!isValidState(request.state)) return "invalid_state";
  return null;
}

export function validateEnvelope(
  envelope: unknown,
  expectedProjectId: string,
): envelope is EncryptedEnvelope {
  if (!envelope || typeof envelope !== "object") return false;
  const value = envelope as Partial<EncryptedEnvelope>;
  if (
    value.schema_version !== SYNC_SCHEMA_VERSION ||
    value.format !== "harness-sync-envelope" ||
    value.project_id !== expectedProjectId ||
    typeof value.project_name !== "string" ||
    value.project_name.length > 200 ||
    !/^[a-f0-9]{64}$/.test(value.plaintext_sha256 ?? "") ||
    value.kdf !== "PBKDF2-HMAC-SHA256" ||
    typeof value.iterations !== "number" ||
    !Number.isInteger(value.iterations) ||
    value.iterations < PBKDF2_MIN_ITERATIONS ||
    value.iterations > PBKDF2_MAX_ITERATIONS ||
    value.cipher !== "AES-256-GCM" ||
    typeof value.created_at !== "string" ||
    !isBase64(value.salt_base64) ||
    !isBase64(value.nonce_base64) ||
    !isBase64(value.ciphertext_base64)
  ) {
    return false;
  }
  let salt: Buffer;
  let nonce: Buffer;
  let ciphertext: Buffer;
  try {
    salt = Buffer.from(value.salt_base64!, "base64");
    nonce = Buffer.from(value.nonce_base64!, "base64");
    ciphertext = Buffer.from(value.ciphertext_base64!, "base64");
  } catch {
    return false;
  }
  return (
    salt.length === 16 &&
    nonce.length === 12 &&
    ciphertext.length >= 16 &&
    ciphertext.length <= MAX_ENVELOPE_BYTES &&
    Buffer.byteLength(JSON.stringify(value), "utf8") <= MAX_ENVELOPE_BYTES
  );
}

function isBase64(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ENVELOPE_BYTES &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  );
}

export function isAllowedOrigin(origin: string | undefined, configured: string[]): boolean {
  if (!origin) return true;
  return configured.includes(origin);
}

export function clientIp(
  headers: Record<string, string | string[] | undefined>,
  fallback: string,
): string {
  const forwarded = headers["x-forwarded-for"];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(",")[0];
  return (first || fallback).trim().slice(0, 128);
}

export function dayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}
