import { ApiError } from "./errors";
import type { Env } from "./types";

export const MAX_PROJECTS = 100;
export const DAILY_OAUTH_LIMIT = 20;
export const DAILY_WRITE_LIMIT = 100;
export const DAILY_READ_LIMIT = 500;
export const DAILY_BYTES_LIMIT = 50 * 900_000;
export const RATE_WINDOW_SECONDS = 120;
export const QUOTA_TTL_SECONDS = 90 * 24 * 60 * 60;

export type QuotaField = "oauthCodes" | "syncWrites" | "syncReads" | "syncBytes";

function dayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function requestIp(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "unknown"
  ).slice(0, 128);
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function requireKv(env: Env): KVNamespace {
  if (!env.OAUTH_KV) {
    throw new ApiError(503, "service_misconfigured", "Cloudflare KV is not configured.");
  }
  return env.OAUTH_KV;
}

function numberValue(raw: string | null): number {
  if (!raw) return 0;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export async function consumeRateLimit(
  request: Request,
  env: Env,
  bucket: string,
  maximum: number,
): Promise<void> {
  const salt = env.RATE_LIMIT_SALT?.trim() ?? "";
  if (salt.length < 32) {
    throw new ApiError(503, "service_misconfigured", "Cloud rate limiting is not configured.");
  }
  const key = "rate:" + (await sha256Hex(salt + ":" + bucket + ":" + requestIp(request)));
  const kv = requireKv(env);
  const current = numberValue(await kv.get(key));
  if (current >= maximum) {
    throw new ApiError(429, "rate_limited", "Too many requests. Try again later.");
  }
  await kv.put(key, String(current + 1), { expirationTtl: RATE_WINDOW_SECONDS });
}

export async function consumeDailyQuota(
  env: Env,
  uid: string,
  field: QuotaField,
  amount: number,
  maximum: number,
): Promise<void> {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new ApiError(400, "invalid_quota_amount", "Quota amount is invalid.");
  }
  const kv = requireKv(env);
  const key = "quota:" + uid + ":" + dayKey() + ":" + field;
  const current = numberValue(await kv.get(key));
  if (current + amount > maximum) {
    throw new ApiError(429, "daily_quota_exceeded", "This account has reached its daily sync quota.");
  }
  await kv.put(key, String(current + amount), { expirationTtl: QUOTA_TTL_SECONDS });
}

async function quotaValue(env: Env, uid: string, field: QuotaField): Promise<number> {
  return numberValue(
    await requireKv(env).get("quota:" + uid + ":" + dayKey() + ":" + field),
  );
}

export async function usageFor(env: Env, uid: string): Promise<Record<string, unknown>> {
  const [oauthCodes, syncWrites, syncReads, syncBytes] = await Promise.all([
    quotaValue(env, uid, "oauthCodes"),
    quotaValue(env, uid, "syncWrites"),
    quotaValue(env, uid, "syncReads"),
    quotaValue(env, uid, "syncBytes"),
  ]);
  return {
    day: dayKey(),
    used: {
      oauth_codes: oauthCodes,
      sync_writes: syncWrites,
      sync_reads: syncReads,
      sync_bytes: syncBytes,
    },
    limits: {
      oauth_codes: DAILY_OAUTH_LIMIT,
      sync_writes: DAILY_WRITE_LIMIT,
      sync_reads: DAILY_READ_LIMIT,
      sync_bytes: DAILY_BYTES_LIMIT,
    },
  };
}
