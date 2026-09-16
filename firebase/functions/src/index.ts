import express, { type NextFunction, type Request, type Response } from "express";
import { getApps, initializeApp } from "firebase-admin/app";
import { getAppCheck } from "firebase-admin/app-check";
import { getAuth, type DecodedIdToken } from "firebase-admin/auth";
import {
  Timestamp,
  getFirestore,
  type DocumentData,
  type DocumentReference,
  type DocumentSnapshot,
} from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2/options";
import { defineSecret } from "firebase-functions/params";
import { createHash } from "node:crypto";

import {
  CLIENT_ID,
  MAX_ENVELOPE_BYTES,
  SUPPORTED_SCOPE,
  type EncryptedEnvelope,
  dayKey,
  hashSecret,
  isAllowedOrigin,
  isValidProjectId,
  isValidRedirectUri,
  randomOpaque,
  safeEqual,
  validateAuthorizeRequest,
  validateEnvelope,
} from "./protocol.js";

setGlobalOptions({
  region: "us-central1",
  maxInstances: 10,
  concurrency: 40,
  memory: "256MiB",
  timeoutSeconds: 30,
});

const firebaseApp = getApps().length > 0 ? getApps()[0] : initializeApp();
const firebaseAuth = getAuth(firebaseApp);
const firestore = getFirestore(firebaseApp);
const rateLimitSaltSecret = defineSecret("RATE_LIMIT_SALT");

const ACCESS_TTL_MS = 15 * 60 * 1000;
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const CODE_TTL_MS = 2 * 60 * 1000;
const RATE_WINDOW_MS = 60 * 1000;
const MAX_BODY_BYTES = 950_000;
const MAX_PROJECTS = 100;
const DAILY_OAUTH_LIMIT = 20;
const DAILY_WRITE_LIMIT = 100;
const DAILY_READ_LIMIT = 500;
const DAILY_BYTES_LIMIT = 50 * MAX_ENVELOPE_BYTES;
const RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

type Principal = {
  uid: string;
  email?: string;
};

type AccessRecord = Principal & {
  clientId: string;
  familyId: string;
};

class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function configuredOrigins(): string[] {
  return (process.env.WEB_ORIGINS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function bearerToken(request: Request): string | null {
  const value = request.get("authorization") ?? "";
  const match = /^Bearer ([A-Za-z0-9._~+/=-]{20,4096})$/.exec(value);
  return match?.[1] ?? null;
}

function requestIp(request: Request): string {
  const forwarded = request.get("x-forwarded-for")?.split(",")[0]?.trim();
  return (forwarded || request.ip || "unknown").slice(0, 128);
}

function nowTimestamp(): Timestamp {
  return Timestamp.now();
}

function timestampMillis(value: unknown): number {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return 0;
}

function timestampIso(value: unknown): string {
  const millis = timestampMillis(value);
  return millis > 0 ? new Date(millis).toISOString() : new Date().toISOString();
}

function projectRef(uid: string, projectId: string): DocumentReference {
  return firestore.collection("users").doc(uid).collection("projects").doc(projectId);
}

function refreshRef(tokenHash: string): DocumentReference {
  return firestore.collection("refreshTokens").doc(tokenHash);
}

function accessRef(tokenHash: string): DocumentReference {
  return firestore.collection("accessTokens").doc(tokenHash);
}

function familyRef(familyId: string): DocumentReference {
  return firestore.collection("refreshFamilies").doc(familyId);
}

function rejectOversizedEnvelope(envelope: unknown): void {
  if (Buffer.byteLength(JSON.stringify(envelope ?? null), "utf8") > MAX_ENVELOPE_BYTES) {
    throw new ApiError(413, "payload_too_large", "Encrypted sync payload is too large.");
  }
}

async function requireAppCheck(request: Request): Promise<void> {
  if (process.env.ENFORCE_APP_CHECK === "false" || process.env.FUNCTIONS_EMULATOR === "true") {
    return;
  }
  const appCheckToken = request.get("x-firebase-appcheck");
  if (!appCheckToken) {
    throw new ApiError(401, "app_check_required", "A verified browser session is required.");
  }
  try {
    await getAppCheck(firebaseApp).verifyToken(appCheckToken);
  } catch {
    throw new ApiError(401, "app_check_invalid", "A verified browser session is required.");
  }
}

async function verifyFirebasePrincipal(request: Request): Promise<Principal> {
  const token = bearerToken(request);
  if (!token) {
    throw new ApiError(401, "unauthenticated", "Firebase authentication is required.");
  }
  let decoded: DecodedIdToken;
  try {
    decoded = await firebaseAuth.verifyIdToken(token, true);
  } catch {
    throw new ApiError(401, "unauthenticated", "Firebase authentication is required.");
  }
  return { uid: decoded.uid, email: decoded.email };
}

async function readAccessPrincipal(request: Request): Promise<AccessRecord | null> {
  const token = bearerToken(request);
  if (!token) return null;
  const snapshot = await accessRef(hashSecret(token)).get();
  if (!snapshot.exists) return null;
  const data = snapshot.data() ?? {};
  if (
    typeof data.uid !== "string" ||
    data.clientId !== CLIENT_ID ||
    timestampMillis(data.expiresAt) <= Date.now()
  ) {
    return null;
  }
  const familyId = typeof data.familyId === "string" ? data.familyId : "";
  if (!familyId) return null;
  const family = await familyRef(familyId).get();
  if (!family.exists || family.data()?.revoked === true) return null;
  return {
    uid: data.uid,
    email: typeof data.email === "string" ? data.email : undefined,
    clientId: data.clientId,
    familyId,
  };
}

async function requireAccessPrincipal(request: Request): Promise<AccessRecord> {
  const principal = await readAccessPrincipal(request);
  if (!principal) {
    throw new ApiError(401, "invalid_token", "Harness cloud access token is invalid or expired.");
  }
  return principal;
}

async function requireAnyPrincipal(request: Request): Promise<Principal> {
  const access = await readAccessPrincipal(request);
  if (access) return access;
  return verifyFirebasePrincipal(request);
}

async function requireAnyPrincipalWithAppCheck(request: Request): Promise<Principal> {
  const access = await readAccessPrincipal(request);
  if (access) return access;
  await requireAppCheck(request);
  return verifyFirebasePrincipal(request);
}

async function consumeRateLimit(
  request: Request,
  bucket: string,
  maximum: number,
): Promise<void> {
  const rateLimitSalt = rateLimitSaltSecret.value() || process.env.RATE_LIMIT_SALT || "";
  if (rateLimitSalt.length < 32) {
    throw new ApiError(503, "service_misconfigured", "Cloud rate limiting is not configured.");
  }
  const key = hashSecret(rateLimitSalt + ":" + bucket + ":" + requestIp(request));
  const reference = firestore.collection("rateLimits").doc(key);
  const now = Date.now();
  let allowed = false;
  await firestore.runTransaction(async (transaction) => {
    const current = await transaction.get(reference);
    const data = current.data() ?? {};
    const windowStarted = typeof data.windowStarted === "number" ? data.windowStarted : 0;
    const count = typeof data.count === "number" ? data.count : 0;
    if (now - windowStarted >= RATE_WINDOW_MS) {
      transaction.set(reference, {
        windowStarted: now,
        count: 1,
        updatedAt: nowTimestamp(),
        expiresAt: Timestamp.fromMillis(now + 2 * RATE_WINDOW_MS),
      });
      allowed = true;
      return;
    }
    if (count >= maximum) return;
    transaction.update(reference, {
      count: count + 1,
      updatedAt: nowTimestamp(),
      expiresAt: Timestamp.fromMillis(now + 2 * RATE_WINDOW_MS),
    });
    allowed = true;
  });
  if (!allowed) {
    throw new ApiError(429, "rate_limited", "Too many requests. Try again later.");
  }
}

async function consumeDailyQuota(
  uid: string,
  field: "oauthCodes" | "syncWrites" | "syncReads" | "syncBytes",
  amount: number,
  maximum: number,
): Promise<void> {
  const reference = firestore
    .collection("users")
    .doc(uid)
    .collection("usage")
    .doc(dayKey());
  await firestore.runTransaction(async (transaction) => {
    const current = await transaction.get(reference);
    const data = current.data() ?? {};
    const used = typeof data[field] === "number" ? data[field] : 0;
    if (used + amount > maximum) {
      throw new ApiError(429, "daily_quota_exceeded", "This account has reached its daily sync quota.");
    }
    transaction.set(
      reference,
      {
        day: dayKey(),
        [field]: used + amount,
        updatedAt: nowTimestamp(),
        expiresAt: Timestamp.fromMillis(Date.now() + 90 * 24 * 60 * 60 * 1000),
      },
      { merge: true },
    );
  });
}

function parseProjectId(value: unknown): string {
  if (!isValidProjectId(value)) {
    throw new ApiError(400, "invalid_project_id", "Project id is invalid.");
  }
  return value;
}

function parseBaseRevision(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new ApiError(400, "invalid_revision", "Base revision is invalid.");
  }
  return value;
}

function validateEnvelopeRequest(
  envelope: unknown,
  projectId: string,
): asserts envelope is EncryptedEnvelope {
  rejectOversizedEnvelope(envelope);
  if (!validateEnvelope(envelope, projectId)) {
    throw new ApiError(400, "invalid_envelope", "Encrypted sync envelope is invalid.");
  }
}

function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function tokenResponse(
  accessToken: string,
  refreshToken: string,
  email: string | undefined,
  now: number,
): Record<string, unknown> {
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: Math.floor(ACCESS_TTL_MS / 1000),
    refresh_token: refreshToken,
    refresh_expires_in: Math.floor(REFRESH_TTL_MS / 1000),
    scope: SUPPORTED_SCOPE,
    user: { email: email ?? null },
    issued_at: new Date(now).toISOString(),
  };
}

async function issueTokens(
  principal: Principal,
  clientId: string,
  existingFamilyId?: string,
): Promise<{ accessToken: string; refreshToken: string; response: Record<string, unknown> }> {
  const accessToken = randomOpaque(32);
  const refreshToken = randomOpaque(40);
  const now = Date.now();
  const familyId = existingFamilyId ?? randomOpaque(18);
  const batch = firestore.batch();
  if (existingFamilyId) {
    // Do not write revoked:false here: a refresh-token replay revokes the
    // entire family and must not be reactivated by a still-live token.
    batch.set(
      familyRef(familyId),
      {
        updatedAt: nowTimestamp(),
        expiresAt: Timestamp.fromMillis(now + REFRESH_TTL_MS),
      },
      { merge: true },
    );
  } else {
    batch.set(familyRef(familyId), {
      uid: principal.uid,
      clientId,
      revoked: false,
      updatedAt: nowTimestamp(),
      expiresAt: Timestamp.fromMillis(now + REFRESH_TTL_MS),
    });
  }
  batch.set(accessRef(hashSecret(accessToken)), {
    uid: principal.uid,
    email: principal.email ?? null,
    clientId,
    familyId,
    expiresAt: Timestamp.fromMillis(now + ACCESS_TTL_MS),
    createdAt: nowTimestamp(),
  });
  batch.set(refreshRef(hashSecret(refreshToken)), {
    uid: principal.uid,
    email: principal.email ?? null,
    clientId,
    familyId,
    expiresAt: Timestamp.fromMillis(now + REFRESH_TTL_MS),
    createdAt: nowTimestamp(),
    usedAt: null,
  });
  await batch.commit();
  return {
    accessToken,
    refreshToken,
    response: tokenResponse(accessToken, refreshToken, principal.email, now),
  };
}

async function exchangeAuthorizationCode(body: DocumentData): Promise<Record<string, unknown>> {
  if (
    body.grant_type !== "authorization_code" ||
    body.client_id !== CLIENT_ID ||
    typeof body.redirect_uri !== "string" ||
    typeof body.code !== "string" ||
    typeof body.code_verifier !== "string" ||
    body.code.length > 512 ||
    body.code_verifier.length > 256 ||
    !isValidRedirectUri(body.redirect_uri)
  ) {
    throw new ApiError(400, "invalid_grant", "Authorization code request is invalid.");
  }
  const reference = firestore.collection("oauthCodes").doc(hashSecret(body.code));
  let principal: Principal | null = null;
  let familyId: string | undefined;
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new ApiError(400, "invalid_grant", "Authorization code is invalid.");
    const data = snapshot.data() ?? {};
    if (
      data.clientId !== CLIENT_ID ||
      data.redirectUri !== body.redirect_uri ||
      typeof data.codeChallenge !== "string" ||
      !safeEqual(data.codeChallenge ?? "", pkceChallenge(body.code_verifier)) ||
      timestampMillis(data.expiresAt) <= Date.now()
    ) {
      throw new ApiError(400, "invalid_grant", "Authorization code is invalid.");
    }
    if (typeof data.uid !== "string") {
      throw new ApiError(400, "invalid_grant", "Authorization code is invalid.");
    }
    principal = {
      uid: data.uid,
      email: typeof data.email === "string" ? data.email : undefined,
    };
    familyId = randomOpaque(18);
    transaction.delete(reference);
  });
  if (!principal) throw new ApiError(400, "invalid_grant", "Authorization code is invalid.");
  const issued = await issueTokens(principal, CLIENT_ID, familyId);
  return issued.response;
}

async function refreshAccessToken(body: DocumentData): Promise<Record<string, unknown>> {
  if (
    body.grant_type !== "refresh_token" ||
    body.client_id !== CLIENT_ID ||
    typeof body.refresh_token !== "string" ||
    body.refresh_token.length > 512
  ) {
    throw new ApiError(400, "invalid_grant", "Refresh token request is invalid.");
  }
  const reference = refreshRef(hashSecret(body.refresh_token));
  let principal: Principal | null = null;
  let familyId = "";
  let replayDetected = false;
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) throw new ApiError(400, "invalid_grant", "Refresh token is invalid.");
    const data = snapshot.data() ?? {};
    familyId = typeof data.familyId === "string" ? data.familyId : "";
    const family = familyId ? await transaction.get(familyRef(familyId)) : null;
    if (
      data.clientId !== CLIENT_ID ||
      !familyId ||
      !family?.exists ||
      family.data()?.uid !== data.uid ||
      family.data()?.clientId !== CLIENT_ID ||
      family.data()?.revoked === true ||
      timestampMillis(data.expiresAt) <= Date.now()
    ) {
      throw new ApiError(400, "invalid_grant", "Refresh token is invalid.");
    }
    if (data.usedAt) {
      transaction.set(familyRef(familyId), { revoked: true, updatedAt: nowTimestamp() }, { merge: true });
      replayDetected = true;
      return;
    }
    if (typeof data.uid !== "string") {
      throw new ApiError(400, "invalid_grant", "Refresh token is invalid.");
    }
    principal = {
      uid: data.uid,
      email: typeof data.email === "string" ? data.email : undefined,
    };
    transaction.update(reference, { usedAt: nowTimestamp() });
  });
  if (replayDetected) {
    throw new ApiError(400, "invalid_grant", "Refresh token replay detected; sign in again.");
  }
  if (!principal || !familyId) throw new ApiError(400, "invalid_grant", "Refresh token is invalid.");
  const issued = await issueTokens(principal, CLIENT_ID, familyId);
  return issued.response;
}

const app = express();
app.disable("x-powered-by");

type AsyncHandler = (request: Request, response: Response) => Promise<void>;

function asyncRoute(handler: AsyncHandler) {
  return (request: Request, response: Response, next: NextFunction) => {
    handler(request, response).catch(next);
  };
}

app.use((request, response, next) => {
  const origin = request.get("origin");
  if (!isAllowedOrigin(origin, configuredOrigins())) {
    response.status(403).json({ error: "origin_not_allowed" });
    return;
  }
  if (origin) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
  }
  response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Firebase-AppCheck");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "no-referrer");
  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }
  next();
});
app.use(express.json({ limit: MAX_BODY_BYTES, strict: true }));

app.get("/health", (_request, response) => {
  response.json({ ok: true, service: "5harness-cloud", version: 1 });
});

app.post("/oauth/authorize", asyncRoute(async (request, response) => {
  await requireAppCheck(request);
  await consumeRateLimit(request, "oauth-authorize", 30);
  const validationError = validateAuthorizeRequest(request.body);
  if (validationError) {
    throw new ApiError(400, validationError, "OAuth authorization request is invalid.");
  }
  const principal = await verifyFirebasePrincipal(request);
  await consumeDailyQuota(principal.uid, "oauthCodes", 1, DAILY_OAUTH_LIMIT);
  const code = randomOpaque(32);
  const body = request.body as Record<string, string>;
  await firestore.collection("oauthCodes").doc(hashSecret(code)).set({
    uid: principal.uid,
    email: principal.email ?? null,
    clientId: CLIENT_ID,
    redirectUri: body.redirect_uri,
    codeChallenge: body.code_challenge,
    scope: SUPPORTED_SCOPE,
    expiresAt: Timestamp.fromMillis(Date.now() + CODE_TTL_MS),
    createdAt: nowTimestamp(),
  });
  response.json({
    redirect_uri: body.redirect_uri,
    code,
    state: body.state,
  });
}));

app.post("/oauth/token", asyncRoute(async (request, response) => {
  await consumeRateLimit(request, "oauth-token", 60);
  const body = (request.body ?? {}) as DocumentData;
  let result: Record<string, unknown>;
  if (body?.grant_type === "authorization_code") {
    result = await exchangeAuthorizationCode(body);
  } else {
    result = await refreshAccessToken(body);
  }
  response.json(result);
}));

app.post("/oauth/revoke", asyncRoute(async (request, response) => {
  await consumeRateLimit(request, "oauth-revoke", 30);
  const body = (request.body ?? {}) as DocumentData;
  if (body?.client_id !== CLIENT_ID || typeof body.refresh_token !== "string") {
    response.status(204).end();
    return;
  }
  const reference = refreshRef(hashSecret(body.refresh_token));
  const snapshot = await reference.get();
  const familyId = snapshot.data()?.familyId;
  if (typeof familyId === "string") {
    await familyRef(familyId).set({ revoked: true, updatedAt: nowTimestamp() }, { merge: true });
  }
  response.status(204).end();
}));

app.post("/oauth/revoke-all", asyncRoute(async (request, response) => {
  await requireAppCheck(request);
  await consumeRateLimit(request, "oauth-revoke-all", 10);
  const principal = await verifyFirebasePrincipal(request);
  const families = await firestore
    .collection("refreshFamilies")
    .where("uid", "==", principal.uid)
    .get();
  for (let start = 0; start < families.docs.length; start += 400) {
    const batch = firestore.batch();
    for (const family of families.docs.slice(start, start + 400)) {
      batch.set(
        family.ref,
        { revoked: true, updatedAt: nowTimestamp() },
        { merge: true },
      );
    }
    await batch.commit();
  }
  response.status(204).end();
}));

app.get("/sync/projects", asyncRoute(async (request, response) => {
  await requireAppCheck(request);
  await consumeRateLimit(request, "sync-projects", 60);
  const principal = await requireAnyPrincipal(request);
  await consumeDailyQuota(principal.uid, "syncReads", 1, DAILY_READ_LIMIT);
  const projects = await firestore
    .collection("users")
    .doc(principal.uid)
    .collection("projects")
    .orderBy("updatedAt", "desc")
    .limit(MAX_PROJECTS)
    .get();
  response.json({
    projects: projects.docs.map((snapshot) => projectMetadata(snapshot)),
  });
}));

app.get("/sync/usage", asyncRoute(async (request, response) => {
  await requireAppCheck(request);
  await consumeRateLimit(request, "sync-usage", 30);
  const principal = await verifyFirebasePrincipal(request);
  const snapshot = await firestore
    .collection("users")
    .doc(principal.uid)
    .collection("usage")
    .doc(dayKey())
    .get();
  const data = snapshot.data() ?? {};
  response.json({
    day: dayKey(),
    used: {
      oauth_codes: data.oauthCodes ?? 0,
      sync_writes: data.syncWrites ?? 0,
      sync_reads: data.syncReads ?? 0,
      sync_bytes: data.syncBytes ?? 0,
    },
    limits: {
      oauth_codes: DAILY_OAUTH_LIMIT,
      sync_writes: DAILY_WRITE_LIMIT,
      sync_reads: DAILY_READ_LIMIT,
      sync_bytes: DAILY_BYTES_LIMIT,
    },
  });
}));

app.get("/sync/snapshots/:projectId", asyncRoute(async (request, response) => {
  await consumeRateLimit(request, "sync-read", 120);
  const principal = await requireAnyPrincipalWithAppCheck(request);
  const projectId = parseProjectId(request.params.projectId);
  await consumeDailyQuota(principal.uid, "syncReads", 1, DAILY_READ_LIMIT);
  const snapshot = await projectRef(principal.uid, projectId).get();
  if (!snapshot.exists) {
    response.status(404).json({ error: "snapshot_not_found" });
    return;
  }
  const data = snapshot.data() ?? {};
  response.json({
    has_snapshot: true,
    project_id: projectId,
    revision: data.revision,
    created_at: timestampIso(data.createdAt),
    updated_at: timestampIso(data.updatedAt),
    envelope: data.envelope,
  });
}));

app.post("/sync/snapshots", asyncRoute(async (request, response) => {
  await consumeRateLimit(request, "sync-write", 30);
  const principal = await requireAccessPrincipal(request);
  const projectId = parseProjectId(request.body?.project_id);
  const baseRevision = parseBaseRevision(request.body?.base_revision);
  const envelope = request.body?.envelope;
  validateEnvelopeRequest(envelope, projectId);
  const envelopeBytes = Buffer.byteLength(JSON.stringify(envelope), "utf8");
  await consumeDailyQuota(principal.uid, "syncWrites", 1, DAILY_WRITE_LIMIT);
  await consumeDailyQuota(principal.uid, "syncBytes", envelopeBytes, DAILY_BYTES_LIMIT);
  const reference = projectRef(principal.uid, projectId);
  const revision = randomOpaque(18);
  const currentTime = nowTimestamp();
  let createdAt = currentTime;
  await firestore.runTransaction(async (transaction) => {
    const existing = await transaction.get(reference);
    const data = existing.data() ?? {};
    if (existing.exists) {
      if (!baseRevision || data.revision !== baseRevision) {
        throw new ApiError(409, "revision_conflict", "Cloud snapshot changed; pull it before pushing.");
      }
      if (data.createdAt) createdAt = data.createdAt as Timestamp;
    } else if (baseRevision) {
      throw new ApiError(409, "revision_conflict", "Cloud snapshot changed; pull it before pushing.");
    } else {
      // Do not maintain a separate counter: Firestore TTL removes expired
      // snapshots without updating a parent document. Count live documents
      // inside this transaction so the cap remains correct after TTL cleanup.
      const projects = await transaction.get(
        firestore.collection("users")
          .doc(principal.uid)
          .collection("projects")
          .limit(MAX_PROJECTS + 1),
      );
      const now = Date.now();
      let liveProjects = 0;
      for (const project of projects.docs) {
        if (timestampMillis(project.data()?.expiresAt) > now) {
          liveProjects += 1;
        } else {
          transaction.delete(project.ref);
        }
      }
      if (liveProjects >= MAX_PROJECTS) {
        throw new ApiError(429, "project_quota_exceeded", "This account has reached its project limit.");
      }
    }
    transaction.set(reference, {
      projectId,
      projectName: envelope.project_name,
      revision,
      envelope,
      plaintextSha256: envelope.plaintext_sha256,
      ciphertextBytes: Buffer.from(envelope.ciphertext_base64, "base64").length,
      createdAt,
      updatedAt: currentTime,
      expiresAt: Timestamp.fromMillis(Date.now() + RETENTION_MS),
    });
  });
  response.json({
    snapshot_id: projectId,
    revision,
    created_at: timestampIso(createdAt),
    plaintext_sha256: envelope.plaintext_sha256,
    ciphertext_bytes: Buffer.from(envelope.ciphertext_base64, "base64").length,
  });
}));

app.delete("/sync/snapshots/:projectId", asyncRoute(async (request, response) => {
  await consumeRateLimit(request, "sync-delete", 30);
  const principal = await requireAnyPrincipalWithAppCheck(request);
  const projectId = parseProjectId(request.params.projectId);
  await consumeDailyQuota(principal.uid, "syncWrites", 1, DAILY_WRITE_LIMIT);
  const reference = projectRef(principal.uid, projectId);
  await firestore.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists) return;
    transaction.delete(reference);
  });
  response.status(204).end();
}));

function projectMetadata(snapshot: DocumentSnapshot): Record<string, unknown> {
  const data = snapshot.data() ?? {};
  return {
    project_id: snapshot.id,
    project_name: data.projectName ?? snapshot.id,
    revision: data.revision ?? null,
    created_at: data.createdAt ? timestampIso(data.createdAt) : null,
    updated_at: data.updatedAt ? timestampIso(data.updatedAt) : null,
    plaintext_sha256: data.plaintextSha256 ?? null,
    ciphertext_bytes: data.ciphertextBytes ?? null,
  };
}

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof ApiError) {
    response.status(error.status).json({ error: error.code, message: error.message });
    return;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    error.type === "entity.too.large"
  ) {
    response.status(413).json({ error: "payload_too_large", message: "Request body is too large." });
    return;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    (error.type === "entity.parse.failed" || error.type === "entity.verify.failed")
  ) {
    response.status(400).json({ error: "invalid_json", message: "Request body must be valid JSON." });
    return;
  }
  console.error("Unhandled cloud API error", error instanceof Error ? error.name : "unknown");
  response.status(500).json({ error: "internal_error", message: "Internal cloud service error." });
});

export const api = onRequest(
  {
    region: "us-central1",
    maxInstances: 10,
    concurrency: 40,
    memory: "256MiB",
    timeoutSeconds: 30,
    invoker: "public",
    secrets: [rateLimitSaltSecret],
  },
  app,
);

export { app };
