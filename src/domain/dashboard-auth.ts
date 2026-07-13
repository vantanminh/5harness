/**
 * Dashboard auth domain types.
 * Credentials are stored machine-locally in ~/.5harness/dashboard-auth.json.
 * Sensitive values are never logged (redacted by the logger pattern).
 */

export type DashboardAuthData = {
  /** Hashed password (salted SHA-256 hex) */
  passwordHash: string;
  /** Salt used for hashing (hex) */
  salt: string;
  /** When the record was created (ISO-8601) */
  created_at: string;
  /** When the record was last updated (ISO-8601) */
  updated_at: string;
};

export type LoginRequest = {
  username: string;
  password: string;
};

export type ChangePasswordRequest = {
  username: string;
  currentPassword: string;
  newPassword: string;
};

export type AuthSession = {
  token: string;
  expiresAt: number;
};
