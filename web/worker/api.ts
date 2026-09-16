import { getBearerToken, verifyFirebaseIdToken } from "./auth";
import { errorJson, json, originAllowed, withCors } from "./cors";
import { ApiError } from "./errors";
import {
  FirestoreError,
  deleteProject,
  listProjects,
  projectMetadata,
  readProject,
  refreshFirebaseIdToken,
  upsertProject,
} from "./firestore";
import {
  DAILY_BYTES_LIMIT,
  DAILY_READ_LIMIT,
  DAILY_WRITE_LIMIT,
  consumeDailyQuota,
  consumeRateLimit,
  usageFor,
} from "./limits";
import {
  DEVICE_APPROVE_ROUTE,
  DEVICE_CSRF_ROUTE,
  getOAuthHelpers,
  handleCompatAuthorize,
  handleCompatRevoke,
  handleCompatRevokeAll,
  handleCompatToken,
  handleDeviceApprove,
  handleDeviceCsrf,
} from "./oauth";
import {
  isValidProjectId,
  MAX_ENVELOPE_BYTES,
  validateEnvelope,
} from "./protocol";
import type { Env } from "./types";

const MAX_BODY_BYTES = 950_000;

type Principal = {
  uid: string;
  email?: string;
  firebaseToken: string;
  kind: "firebase" | "oauth";
  scopes: string[];
  firestoreEnv: Env;
};

function safeProjectId(value: unknown): string {
  if (!isValidProjectId(value)) {
    throw new ApiError(400, "invalid_project_id", "Project id is invalid.");
  }
  return value;
}

function baseRevision(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "string" ||
    value.length > 256 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new ApiError(400, "invalid_revision", "Base revision is invalid.");
  }
  return value;
}

async function bodyObject(request: Request): Promise<Record<string, unknown>> {
  const length = Number(request.headers.get("Content-Length") ?? "0");
  if (length > MAX_BODY_BYTES) {
    throw new ApiError(413, "payload_too_large", "Request body is too large.");
  }
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BODY_BYTES) {
    throw new ApiError(413, "payload_too_large", "Request body is too large.");
  }
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object");
    return value as Record<string, unknown>;
  } catch {
    throw new ApiError(400, "invalid_json", "Request body must be valid JSON.");
  }
}

function projectFromPath(pathname: string): string {
  const prefix = "/api/sync/snapshots/";
  try {
    return safeProjectId(decodeURIComponent(pathname.slice(prefix.length)));
  } catch {
    throw new ApiError(400, "invalid_project_id", "Project id is invalid.");
  }
}

function errorFor(error: unknown): { status: number; code: string; message: string } {
  if (error instanceof ApiError) {
    return { status: error.status, code: error.code, message: error.message };
  }
  if (error instanceof FirestoreError) {
    if (error.status === 409) {
      return { status: 409, code: "revision_conflict", message: error.message };
    }
    if (error.status === 429) {
      return { status: 429, code: "project_quota_exceeded", message: error.message };
    }
    if (error.status === 401 || error.status === 403) {
      return {
        status: error.status,
        code: "unauthenticated",
        message: "Firebase authentication is required.",
      };
    }
    return {
      status: error.status,
      code: "firestore_unavailable",
      message: "Firestore is temporarily unavailable.",
    };
  }
  if (error && typeof error === "object" && "status" in error) {
    const status = Number((error as { status?: unknown }).status);
    if (status === 401 || status === 403) {
      return {
        status,
        code: "unauthenticated",
        message: "Firebase authentication is required.",
      };
    }
  }
  return {
    status: 500,
    code: "internal_error",
    message: "Internal cloud service error.",
  };
}

async function principalFromRequest(request: Request, env: Env): Promise<Principal> {
  const token = getBearerToken(request);
  const provider = getOAuthHelpers(env);
  const tokenData = await provider.unwrapToken(token).catch(() => null);
  if (tokenData) {
    const props = tokenData.grant.props as Partial<{
      uid: string;
      projectId: string;
      firebaseApiKey: string;
      firebaseRefreshToken: string;
      firestoreApiBaseUrl?: string;
    }>;
    if (
      typeof props.uid !== "string" ||
      typeof props.projectId !== "string" ||
      typeof props.firebaseApiKey !== "string" ||
      typeof props.firebaseRefreshToken !== "string" ||
      props.uid !== tokenData.userId ||
      props.projectId !== env.FIREBASE_PROJECT_ID ||
      props.firebaseApiKey !== env.FIREBASE_API_KEY
    ) {
      throw new ApiError(401, "invalid_token", "Harness access token is invalid.");
    }
    const refreshed = await refreshFirebaseIdToken(
      props.firebaseRefreshToken,
      props.firebaseApiKey,
    );
    const user = await verifyFirebaseIdToken(refreshed, env);
    if (user.uid !== props.uid) {
      throw new ApiError(401, "invalid_token", "Harness access token is invalid.");
    }
    return {
      uid: user.uid,
      email: user.email,
      firebaseToken: refreshed,
      kind: "oauth",
      scopes: tokenData.scope,
      firestoreEnv: {
        ...env,
        FIRESTORE_API_BASE_URL: props.firestoreApiBaseUrl,
      },
    };
  }
  const user = await verifyFirebaseIdToken(token, env);
  return {
    uid: user.uid,
    email: user.email,
    firebaseToken: token,
    kind: "firebase",
    scopes: ["sync:read", "sync:write"],
    firestoreEnv: env,
  };
}

function requireScope(principal: Principal, scope: string): void {
  if (!principal.scopes.includes(scope)) {
    throw new ApiError(403, "insufficient_scope", "This operation requires " + scope + ".");
  }
}

export async function handleApi(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!originAllowed(request, env)) {
    return errorJson(request, env, "origin_not_allowed", "Browser origin is not allowed.", 403);
  }
  if (request.method === "OPTIONS") {
    return withCors(request, env, new Response(null, { status: 204 }));
  }
  const url = new URL(request.url);
  try {
    if (url.pathname === "/api/health" && request.method === "GET") {
      return json(request, env, {
        ok: true,
        service: "5harness-cloud-worker",
        firebaseProject: Boolean(env.FIREBASE_PROJECT_ID),
        firestoreRest: true,
        oauthKv: Boolean(env.OAUTH_KV),
        oauth: true,
        mcp: true,
        blazeRequired: false,
      });
    }
    if (url.pathname === "/api/oauth/authorize" && request.method === "POST") {
      return handleCompatAuthorize(request, env);
    }
    if (url.pathname === "/api/oauth/token" && request.method === "POST") {
      return handleCompatToken(request, env, ctx);
    }
    if (url.pathname === "/api/oauth/revoke" && request.method === "POST") {
      return handleCompatRevoke(request, env, ctx);
    }
    if (url.pathname === "/api/oauth/revoke-all" && request.method === "POST") {
      return handleCompatRevokeAll(request, env);
    }
    if (url.pathname === DEVICE_CSRF_ROUTE && request.method === "GET") {
      return handleDeviceCsrf(request, env);
    }
    if (url.pathname === DEVICE_APPROVE_ROUTE && request.method === "POST") {
      return handleDeviceApprove(request, env);
    }
    if (url.pathname === "/api/sync/usage" && request.method === "GET") {
      await consumeRateLimit(request, env, "sync-usage", 30);
      const principal = await principalFromRequest(request, env);
      requireScope(principal, "sync:read");
      await consumeDailyQuota(env, principal.uid, "syncReads", 1, DAILY_READ_LIMIT);
      return json(request, env, await usageFor(env, principal.uid));
    }
    if (url.pathname === "/api/sync/projects" && request.method === "GET") {
      await consumeRateLimit(request, env, "sync-projects", 60);
      const principal = await principalFromRequest(request, env);
      requireScope(principal, "sync:read");
      await consumeDailyQuota(env, principal.uid, "syncReads", 1, DAILY_READ_LIMIT);
      const projects = await listProjects(
        principal.firebaseToken,
        principal.firestoreEnv,
        principal.uid,
      );
      return json(request, env, { projects: projects.map(projectMetadata) });
    }
    if (
      url.pathname.startsWith("/api/sync/snapshots/") &&
      (request.method === "GET" || request.method === "DELETE")
    ) {
      await consumeRateLimit(request, env, "sync-snapshot", request.method === "GET" ? 120 : 30);
      const principal = await principalFromRequest(request, env);
      requireScope(principal, request.method === "GET" ? "sync:read" : "sync:write");
      const projectId = projectFromPath(url.pathname);
      await consumeDailyQuota(
        env,
        principal.uid,
        request.method === "GET" ? "syncReads" : "syncWrites",
        1,
        request.method === "GET" ? DAILY_READ_LIMIT : DAILY_WRITE_LIMIT,
      );
      if (request.method === "DELETE") {
        await deleteProject(
          principal.firebaseToken,
          principal.firestoreEnv,
          principal.uid,
          projectId,
        );
        return withCors(request, env, new Response(null, { status: 204 }));
      }
      const record = await readProject(
        principal.firebaseToken,
        principal.firestoreEnv,
        principal.uid,
        projectId,
      );
      if (!record) {
        return errorJson(request, env, "snapshot_not_found", "Snapshot was not found.", 404);
      }
      return json(request, env, {
        has_snapshot: true,
        project_id: projectId,
        revision: record.revision,
        created_at: record.createdAt,
        updated_at: record.updatedAt,
        envelope: record.envelope,
      });
    }
    if (url.pathname === "/api/sync/snapshots" && request.method === "POST") {
      await consumeRateLimit(request, env, "sync-write", 30);
      const principal = await principalFromRequest(request, env);
      if (principal.kind !== "oauth") {
        throw new ApiError(
          401,
          "invalid_token",
          "A Harness CLI access token is required for writes.",
        );
      }
      requireScope(principal, "sync:write");
      const body = await bodyObject(request);
      const projectId = safeProjectId(body.project_id);
      const envelope = body.envelope;
      if (!validateEnvelope(envelope, projectId)) {
        throw new ApiError(400, "invalid_envelope", "Encrypted sync envelope is invalid.");
      }
      const encodedBytes = new TextEncoder().encode(JSON.stringify(envelope)).byteLength;
      if (encodedBytes > MAX_ENVELOPE_BYTES) {
        throw new ApiError(413, "payload_too_large", "Encrypted sync payload is too large.");
      }
      await consumeDailyQuota(env, principal.uid, "syncWrites", 1, DAILY_WRITE_LIMIT);
      await consumeDailyQuota(env, principal.uid, "syncBytes", encodedBytes, DAILY_BYTES_LIMIT);
      const result = await upsertProject(
        principal.firebaseToken,
        principal.firestoreEnv,
        principal.uid,
        projectId,
        envelope.project_name,
        envelope,
        baseRevision(body.base_revision),
      );
      return json(request, env, {
        snapshot_id: projectId,
        revision: result.revision,
        created_at: result.createdAt,
        plaintext_sha256: envelope.plaintext_sha256,
        ciphertext_bytes: result.ciphertextBytes,
      });
    }
    return errorJson(request, env, "not_found", "API route was not found.", 404);
  } catch (error) {
    const failure = errorFor(error);
    if (!(error instanceof ApiError && error.code === "invalid_project_id")) {
      console.error(
        "Harness Cloud API request failed",
        error instanceof Error ? error.name : "unknown",
      );
    }
    return errorJson(request, env, failure.code, failure.message, failure.status);
  }
}
