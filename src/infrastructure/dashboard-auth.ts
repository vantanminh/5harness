import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DashboardAuthData } from "../domain/dashboard-auth.js";
import { getHarnessHome } from "./registry.js";

const AUTH_FILENAME = "dashboard-auth.json";
const DEFAULT_USERNAME = "admin";
const DEFAULT_PASSWORD = "admin";
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const TOKEN_BYTES = 32;

export function authFilePath(harnessHome?: string): string {
  const home = harnessHome ?? getHarnessHome();
  return path.join(home, AUTH_FILENAME);
}

function generateSalt(): string {
  return crypto.randomBytes(16).toString("hex");
}

function hashPassword(password: string, salt: string): string {
  return crypto
    .createHash("sha256")
    .update(salt + password)
    .digest("hex");
}

/**
 * Read auth data from disk. Returns null if no auth file exists.
 */
export function readAuthData(options?: {
  harnessHome?: string;
}): DashboardAuthData | null {
  const file = authFilePath(options?.harnessHome);
  if (!fs.existsSync(file)) return null;
  try {
    const raw = fs.readFileSync(file, "utf8");
    return JSON.parse(raw) as DashboardAuthData;
  } catch {
    return null;
  }
}

/**
 * Write auth data to disk atomically.
 */
export function writeAuthData(
  data: DashboardAuthData,
  options?: { harnessHome?: string },
): string {
  const file = authFilePath(options?.harnessHome);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, payload, "utf8");
  fs.renameSync(tmp, file);
  return file;
}

/**
 * Ensure default auth exists. If no auth file is present, create one with
 * admin/admin. Returns the current auth data.
 */
export function ensureDefaultAuth(options?: {
  harnessHome?: string;
}): DashboardAuthData {
  const existing = readAuthData(options);
  if (existing) return existing;

  const salt = generateSalt();
  const now = new Date().toISOString();
  const data: DashboardAuthData = {
    passwordHash: hashPassword(DEFAULT_PASSWORD, salt),
    salt,
    created_at: now,
    updated_at: now,
  };
  writeAuthData(data, options);
  return data;
}

/**
 * Verify a username + password against stored credentials.
 * Only "admin" is a valid username.
 */
export function verifyCredentials(
  username: string,
  password: string,
  options?: { harnessHome?: string },
): boolean {
  if (username !== DEFAULT_USERNAME) return false;
  const data = readAuthData(options);
  if (!data) {
    // Auto-create default on first verify attempt
    const d = ensureDefaultAuth(options);
    return hashPassword(password, d.salt) === d.passwordHash;
  }
  return hashPassword(password, data.salt) === data.passwordHash;
}

/**
 * Change the stored password. Requires the current password.
 * Returns true on success, false if current password is wrong.
 */
export function changePassword(
  username: string,
  currentPassword: string,
  newPassword: string,
  options?: { harnessHome?: string },
): boolean {
  if (username !== DEFAULT_USERNAME) return false;
  if (!newPassword || newPassword.length < 1) return false;
  if (!verifyCredentials(username, currentPassword, options)) return false;

  const salt = generateSalt();
  const now = new Date().toISOString();
  const existing = readAuthData(options);
  const data: DashboardAuthData = {
    passwordHash: hashPassword(newPassword, salt),
    salt,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
  writeAuthData(data, options);
  return true;
}

/**
 * Generate a session token (random bytes hex-encoded).
 */
export function generateSessionToken(): {
  token: string;
  expiresAt: number;
} {
  return {
    token: crypto.randomBytes(TOKEN_BYTES).toString("hex"),
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
}

// In-memory session store (valid for process lifetime — dashboard restarts clear all sessions)
const sessions = new Map<
  string,
  { token: string; expiresAt: number }
>();

/**
 * Create a new session and return the token + expiry.
 */
export function createSession(): { token: string; expiresAt: number } {
  const session = generateSessionToken();
  sessions.set(session.token, session);
  return session;
}

/**
 * Validate a session token. Returns true if valid and not expired.
 */
export function validateSession(token: string): boolean {
  const session = sessions.get(token);
  if (!session) return false;
  if (Date.now() > session.expiresAt) {
    sessions.delete(token);
    return false;
  }
  return true;
}

/**
 * Destroy a session.
 */
export function destroySession(token: string): void {
  sessions.delete(token);
}

/**
 * Extract the session token from the Cookie header string.
 */
export function extractSessionToken(
  cookieHeader?: string,
): string | null {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(
    /(?:^|;\s*)harness_session=([^;]+)/,
  );
  return match ? match[1] : null;
}

/**
 * Directly set a password (no current-password check).
 * Used by CLI `set-password` path.
 */
export function setPasswordDirectly(
  newPassword: string,
  options?: { harnessHome?: string },
): DashboardAuthData {
  if (!newPassword || newPassword.length < 1) {
    throw new Error("Password must not be empty");
  }
  const salt = generateSalt();
  const now = new Date().toISOString();
  const existing = readAuthData(options);
  const data: DashboardAuthData = {
    passwordHash: hashPassword(newPassword, salt),
    salt,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
  writeAuthData(data, options);
  return data;
}
