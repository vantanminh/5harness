import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

/** Cloudflare bindings and public runtime configuration for Harness Cloud. */
export interface Env {
  /** Vite SPA assets served by the same Worker as the API. */
  ASSETS?: Fetcher;
  /** OAuth clients, grants, tokens, and quota/rate-limit counters. */
  OAUTH_KV: KVNamespace;
  /** Firebase project id used for ID-token audience/issuer validation. */
  FIREBASE_PROJECT_ID: string;
  /** Public Firebase Web API key used to exchange refresh credentials. */
  FIREBASE_API_KEY: string;
  /** Optional Firestore REST base URL for local emulator tests only. */
  FIRESTORE_API_BASE_URL?: string;
  /** Comma-separated exact browser origins allowed for cross-origin API calls. */
  CORS_ORIGINS?: string;
  /** High-entropy Cloudflare secret used to salt IP rate-limit keys. */
  RATE_LIMIT_SALT?: string;
  /** Injected by OAuthProvider while dispatching protected requests. */
  OAUTH_PROVIDER?: OAuthHelpers;
}

export interface AuthUser {
  uid: string;
  email?: string;
  emailVerified?: boolean;
}

/** Encrypted grant properties needed to refresh Firebase for CLI/MCP calls. */
export interface HarnessOAuthProps {
  uid: string;
  projectId: string;
  firebaseApiKey: string;
  firebaseRefreshToken: string;
  firestoreApiBaseUrl?: string;
}
