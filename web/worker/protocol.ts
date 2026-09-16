export const SYNC_SCHEMA_VERSION = 1;
export const PBKDF2_MIN_ITERATIONS = 100_000;
export const PBKDF2_MAX_ITERATIONS = 2_000_000;
export const MAX_ENVELOPE_BYTES = 900_000;
export const MAX_PROJECT_ID_LENGTH = 64;
export const CLIENT_ID = "harness-cli";
export const SYNC_READ_SCOPE = "sync:read";
export const SYNC_WRITE_SCOPE = "sync:write";
export const SUPPORTED_SCOPE = SYNC_READ_SCOPE + " " + SYNC_WRITE_SCOPE;

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

export function randomOpaque(bytes = 32): string {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
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
    const loopback = ["127.0.0.1", "localhost", "::1", "[::1]"].includes(host);
    return (
      url.protocol === "http:" &&
      loopback &&
      url.pathname === "/callback" &&
      Boolean(url.port) &&
      Number(url.port) >= 1 &&
      Number(url.port) <= 65535 &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
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

function isBase64(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_ENVELOPE_BYTES &&
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  );
}

function base64Bytes(value: string): number {
  try {
    return atob(value).length;
  } catch {
    return -1;
  }
}

export function validateEnvelope(
  envelope: unknown,
  expectedProjectId: string,
): envelope is EncryptedEnvelope {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
    return false;
  }
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
  if (
    base64Bytes(value.salt_base64) !== 16 ||
    base64Bytes(value.nonce_base64) !== 12 ||
    base64Bytes(value.ciphertext_base64) < 16
  ) {
    return false;
  }
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength <= MAX_ENVELOPE_BYTES;
  } catch {
    return false;
  }
}
