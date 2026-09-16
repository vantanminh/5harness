import { ApiError } from "./errors";
import type { EncryptedEnvelope } from "./protocol";
import { MAX_PROJECTS } from "./limits";
import type { Env } from "./types";

const FIRESTORE_REST_BASE = "https://firestore.googleapis.com/v1";
const RETENTION_MS = 180 * 24 * 60 * 60 * 1000;

export interface FirestoreValue {
  nullValue?: string;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number | string;
  timestampValue?: string;
  stringValue?: string;
  bytesValue?: string;
  referenceValue?: string;
  arrayValue?: { values?: FirestoreValue[] };
  mapValue?: { fields?: Record<string, FirestoreValue> };
}

export interface FirestoreDocument {
  name?: string;
  fields?: Record<string, FirestoreValue>;
  updateTime?: string;
}

export interface ProjectRecord {
  projectId: string;
  projectName: string;
  revision: string | null;
  envelope: EncryptedEnvelope | null;
  plaintextSha256: string | null;
  ciphertextBytes: number | null;
  createdAt: string | null;
  updatedAt: string | null;
  expiresAt: string | null;
  updateTime?: string;
}

export class FirestoreError extends Error {
  readonly status: number;

  constructor(message: string, status = 502) {
    super(message);
    this.name = "FirestoreError";
    this.status = status;
  }
}

export function decodeFirestoreValue(value: FirestoreValue | undefined): unknown {
  if (!value) return null;
  if ("nullValue" in value) return null;
  if ("booleanValue" in value) return value.booleanValue;
  if ("integerValue" in value) {
    const parsed = Number(value.integerValue);
    return Number.isSafeInteger(parsed) ? parsed : value.integerValue;
  }
  if ("doubleValue" in value) {
    if (value.doubleValue === "NaN") return Number.NaN;
    if (value.doubleValue === "Infinity") return Number.POSITIVE_INFINITY;
    if (value.doubleValue === "-Infinity") return Number.NEGATIVE_INFINITY;
    return value.doubleValue;
  }
  if ("timestampValue" in value) return value.timestampValue;
  if ("stringValue" in value) return value.stringValue;
  if ("bytesValue" in value) return value.bytesValue;
  if ("referenceValue" in value) return value.referenceValue;
  if ("arrayValue" in value) {
    return (value.arrayValue?.values ?? []).map((item) => decodeFirestoreValue(item));
  }
  if ("mapValue" in value) return decodeFirestoreFields(value.mapValue?.fields ?? {});
  return null;
}

export function decodeFirestoreFields(
  fields: Record<string, FirestoreValue>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, decodeFirestoreValue(value)]),
  );
}

export function decodeFirestoreDocument(
  document: FirestoreDocument,
): Record<string, unknown> {
  return decodeFirestoreFields(document.fields ?? {});
}

export function encodeFirestoreValue(value: unknown): FirestoreValue {
  if (value === null) return { nullValue: "NULL_VALUE" };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new FirestoreError("Firestore value is not finite.", 400);
    return Number.isSafeInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map((item) => encodeFirestoreValue(item)) } };
  }
  if (typeof value === "object" && value !== null) {
    return {
      mapValue: {
        fields: Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .filter(([, item]) => item !== undefined)
            .map(([key, item]) => [key, encodeFirestoreValue(item)]),
        ),
      },
    };
  }
  throw new FirestoreError("Firestore value is invalid.", 400);
}

export function encodeFirestoreFields(
  fields: Record<string, unknown>,
): Record<string, FirestoreValue> {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, encodeFirestoreValue(value)]),
  );
}

function firestoreBase(env: Pick<Env, "FIRESTORE_API_BASE_URL">): string {
  const value = (env.FIRESTORE_API_BASE_URL ?? FIRESTORE_REST_BASE).trim().replace(/\/+$/, "");
  try {
    const url = new URL(value);
    const loopback = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(
      url.hostname.toLowerCase(),
    );
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
      throw new Error("unsafe");
    }
  } catch {
    throw new FirestoreError("Firestore REST base URL is invalid.", 500);
  }
  return value;
}

function documentUrl(env: Env, uid: string, projectId?: string): string {
  const firebaseProject = env.FIREBASE_PROJECT_ID?.trim();
  if (!firebaseProject) throw new FirestoreError("Firebase project is not configured.", 500);
  const base =
    firestoreBase(env) +
    "/projects/" +
    encodeURIComponent(firebaseProject) +
    "/databases/(default)/documents/users/" +
    encodeURIComponent(uid);
  return projectId === undefined
    ? base + "/projects"
    : base + "/projects/" + encodeURIComponent(projectId);
}

async function firestoreResponse(
  token: string,
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: "Bearer " + token,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
}

async function readDocument(
  token: string,
  env: Env,
  uid: string,
  projectId: string,
): Promise<FirestoreDocument | null> {
  const response = await firestoreResponse(token, documentUrl(env, uid, projectId));
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new FirestoreError(
      "Firestore REST returned HTTP " + response.status + ".",
      response.status >= 500 ? 502 : response.status,
    );
  }
  try {
    return (await response.json()) as FirestoreDocument;
  } catch {
    throw new FirestoreError("Firestore REST returned invalid JSON.");
  }
}

function projectFromDocument(document: FirestoreDocument): ProjectRecord | null {
  const fields = decodeFirestoreDocument(document);
  const projectId = typeof fields.projectId === "string" ? fields.projectId : "";
  if (!projectId) return null;
  const envelope =
    fields.envelope && typeof fields.envelope === "object"
      ? (fields.envelope as EncryptedEnvelope)
      : null;
  return {
    projectId,
    projectName: typeof fields.projectName === "string" ? fields.projectName : projectId,
    revision: typeof fields.revision === "string" ? fields.revision : null,
    envelope,
    plaintextSha256:
      typeof fields.plaintextSha256 === "string" ? fields.plaintextSha256 : null,
    ciphertextBytes:
      typeof fields.ciphertextBytes === "number" ? fields.ciphertextBytes : null,
    createdAt: typeof fields.createdAt === "string" ? fields.createdAt : null,
    updatedAt: typeof fields.updatedAt === "string" ? fields.updatedAt : null,
    expiresAt: typeof fields.expiresAt === "string" ? fields.expiresAt : null,
    updateTime: document.updateTime,
  };
}

function expired(record: ProjectRecord): boolean {
  return Boolean(record.expiresAt && Date.parse(record.expiresAt) <= Date.now());
}

export async function readProject(
  token: string,
  env: Env,
  uid: string,
  projectId: string,
): Promise<ProjectRecord | null> {
  const document = await readDocument(token, env, uid, projectId);
  const record = document ? projectFromDocument(document) : null;
  if (record && expired(record)) {
    await deleteProject(token, env, uid, projectId);
    return null;
  }
  return record;
}

export async function listProjects(
  token: string,
  env: Env,
  uid: string,
): Promise<ProjectRecord[]> {
  const records: ProjectRecord[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < 2; page++) {
    const url = new URL(documentUrl(env, uid));
    url.searchParams.set("pageSize", String(MAX_PROJECTS + 1));
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await firestoreResponse(token, url.toString());
    if (!response.ok) {
      throw new FirestoreError(
        "Firestore REST returned HTTP " + response.status + ".",
        response.status >= 500 ? 502 : response.status,
      );
    }
    let payload: { documents?: FirestoreDocument[]; nextPageToken?: string };
    try {
      payload = (await response.json()) as typeof payload;
    } catch {
      throw new FirestoreError("Firestore REST returned invalid JSON.");
    }
    for (const document of payload.documents ?? []) {
      const record = projectFromDocument(document);
      if (record) records.push(record);
      if (records.length > MAX_PROJECTS) break;
    }
    if (records.length > MAX_PROJECTS || !payload.nextPageToken) break;
    pageToken = payload.nextPageToken;
  }
  const expiredRecords = records.filter(expired);
  await Promise.all(
    expiredRecords.map((record) => deleteProject(token, env, uid, record.projectId)),
  );
  return records
    .filter((record) => !expired(record))
    .sort((left, right) => Date.parse(right.updatedAt ?? "") - Date.parse(left.updatedAt ?? ""))
    .slice(0, MAX_PROJECTS);
}

export async function deleteProject(
  token: string,
  env: Env,
  uid: string,
  projectId: string,
): Promise<void> {
  const response = await firestoreResponse(
    token,
    documentUrl(env, uid, projectId),
    { method: "DELETE" },
  );
  if (!response.ok && response.status !== 404) {
    throw new FirestoreError(
      "Firestore REST returned HTTP " + response.status + " while deleting.",
      response.status >= 500 ? 502 : response.status,
    );
  }
}

function timestampValue(value: string): FirestoreValue {
  return { timestampValue: value };
}

function projectFields(
  projectId: string,
  projectName: string,
  revision: string,
  envelope: EncryptedEnvelope,
  createdAt: string,
  updatedAt: string,
  expiresAt: string,
): Record<string, FirestoreValue> {
  return {
    ...encodeFirestoreFields({
      projectId,
      projectName,
      revision,
      envelope,
      plaintextSha256: envelope.plaintext_sha256,
      ciphertextBytes: Math.floor(atob(envelope.ciphertext_base64).length),
    }),
    createdAt: timestampValue(createdAt),
    updatedAt: timestampValue(updatedAt),
    expiresAt: timestampValue(expiresAt),
  };
}

export async function upsertProject(
  token: string,
  env: Env,
  uid: string,
  projectId: string,
  projectName: string,
  envelope: EncryptedEnvelope,
  baseRevision: string | null,
): Promise<{ record: ProjectRecord; revision: string; createdAt: string; ciphertextBytes: number }> {
  let existing = await readDocument(token, env, uid, projectId);
  let existingRecord = existing ? projectFromDocument(existing) : null;
  if (existingRecord && expired(existingRecord)) {
    await deleteProject(token, env, uid, projectId);
    existing = null;
    existingRecord = null;
  }
  if (existingRecord) {
    if (!baseRevision || existingRecord.revision !== baseRevision) {
      throw new FirestoreError("Cloud snapshot changed; pull it before pushing.", 409);
    }
  } else {
    if (baseRevision) {
      throw new FirestoreError("Cloud snapshot changed; pull it before pushing.", 409);
    }
    const projects = await listProjects(token, env, uid);
    if (projects.length >= MAX_PROJECTS) {
      throw new FirestoreError("This account has reached its project limit.", 429);
    }
  }

  const revisionBytes = new Uint8Array(18);
  crypto.getRandomValues(revisionBytes);
  let revision = "";
  for (const byte of revisionBytes) revision += byte.toString(16).padStart(2, "0");
  const now = new Date().toISOString();
  const createdAt = existingRecord?.createdAt ?? now;
  const expiresAt = new Date(Date.now() + RETENTION_MS).toISOString();
  const fields = projectFields(
    projectId,
    projectName,
    revision,
    envelope,
    createdAt,
    now,
    expiresAt,
  );
  const url = new URL(documentUrl(env, uid, projectId));
  for (const fieldName of Object.keys(fields)) {
    url.searchParams.append("updateMask.fieldPaths", fieldName);
  }
  if (existing?.updateTime) {
    url.searchParams.set("currentDocument.updateTime", existing.updateTime);
  } else {
    url.searchParams.set("currentDocument.exists", "false");
  }
  const response = await firestoreResponse(token, url.toString(), {
    method: "PATCH",
    body: JSON.stringify({ fields }),
  });
  if (response.status === 409 || response.status === 412) {
    throw new FirestoreError("Cloud snapshot changed; pull it before pushing.", 409);
  }
  if (!response.ok) {
    throw new FirestoreError(
      "Firestore REST returned HTTP " + response.status + " while writing.",
      response.status >= 500 ? 502 : response.status,
    );
  }
  let written: FirestoreDocument = { fields, updateTime: now };
  try {
    written = (await response.json()) as FirestoreDocument;
  } catch {
    // Firestore may return an empty body in emulator-compatible implementations.
  }
  const record = projectFromDocument(written) ?? {
    projectId,
    projectName,
    revision,
    envelope,
    plaintextSha256: envelope.plaintext_sha256,
    ciphertextBytes: atob(envelope.ciphertext_base64).length,
    createdAt,
    updatedAt: now,
    expiresAt,
    updateTime: written.updateTime,
  };
  return {
    record,
    revision,
    createdAt,
    ciphertextBytes: atob(envelope.ciphertext_base64).length,
  };
}

function nestedUrl(
  env: Env,
  uid: string,
  projectId: string,
  collection: string,
  docId?: string,
): string {
  const base = documentUrl(env, uid, projectId) + "/" + encodeURIComponent(collection);
  return docId === undefined ? base : base + "/" + encodeURIComponent(docId);
}

function userDocUrl(env: Env, uid: string, collection: string, docId?: string): string {
  const firebaseProject = env.FIREBASE_PROJECT_ID?.trim();
  if (!firebaseProject) throw new FirestoreError("Firebase project is not configured.", 500);
  const base =
    firestoreBase(env) +
    "/projects/" +
    encodeURIComponent(firebaseProject) +
    "/databases/(default)/documents/users/" +
    encodeURIComponent(uid) +
    "/" +
    encodeURIComponent(collection);
  return docId === undefined ? base : base + "/" + encodeURIComponent(docId);
}

async function patchDocument(
  token: string,
  url: string,
  fields: Record<string, unknown>,
  createOnly = false,
): Promise<FirestoreDocument> {
  const encoded = encodeFirestoreFields(fields);
  const target = new URL(url);
  for (const fieldName of Object.keys(encoded)) {
    target.searchParams.append("updateMask.fieldPaths", fieldName);
  }
  if (createOnly) target.searchParams.set("currentDocument.exists", "false");
  const response = await firestoreResponse(token, target.toString(), {
    method: "PATCH",
    body: JSON.stringify({ fields: encoded }),
  });
  if (response.status === 409 || response.status === 412) {
    throw new FirestoreError("Cloud document already exists.", 409);
  }
  if (!response.ok) {
    throw new FirestoreError(
      "Firestore REST returned HTTP " + response.status + " while writing.",
      response.status >= 500 ? 502 : response.status,
    );
  }
  try {
    return (await response.json()) as FirestoreDocument;
  } catch {
    return { fields: encoded };
  }
}

async function getDocument(token: string, url: string): Promise<FirestoreDocument | null> {
  const response = await firestoreResponse(token, url);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new FirestoreError(
      "Firestore REST returned HTTP " + response.status + ".",
      response.status >= 500 ? 502 : response.status,
    );
  }
  try {
    return (await response.json()) as FirestoreDocument;
  } catch {
    throw new FirestoreError("Firestore REST returned invalid JSON.");
  }
}

export async function writeCommit(
  token: string,
  env: Env,
  uid: string,
  projectId: string,
  commit: Record<string, unknown>,
): Promise<void> {
  const id = String(commit.id ?? "");
  if (!id) throw new FirestoreError("Commit id is required.", 400);
  await patchDocument(token, nestedUrl(env, uid, projectId, "commits", id), commit, true);
}

export async function listCommits(
  token: string,
  env: Env,
  uid: string,
  projectId: string,
): Promise<Record<string, unknown>[]> {
  const url = new URL(nestedUrl(env, uid, projectId, "commits"));
  url.searchParams.set("pageSize", "100");
  const response = await firestoreResponse(token, url.toString());
  if (response.status === 404) return [];
  if (!response.ok) {
    throw new FirestoreError(
      "Firestore REST returned HTTP " + response.status + ".",
      response.status >= 500 ? 502 : response.status,
    );
  }
  let payload: { documents?: FirestoreDocument[] };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    throw new FirestoreError("Firestore REST returned invalid JSON.");
  }
  return (payload.documents ?? [])
    .map((document) => decodeFirestoreDocument(document))
    .sort(
      (left, right) =>
        Date.parse(String(right.created_at ?? "")) - Date.parse(String(left.created_at ?? "")),
    );
}

export async function readCommit(
  token: string,
  env: Env,
  uid: string,
  projectId: string,
  commitId: string,
): Promise<Record<string, unknown> | null> {
  const document = await getDocument(
    token,
    nestedUrl(env, uid, projectId, "commits", commitId),
  );
  return document ? decodeFirestoreDocument(document) : null;
}

export async function writeCatalog(
  token: string,
  env: Env,
  uid: string,
  projectId: string,
  catalog: Record<string, unknown>,
): Promise<void> {
  await patchDocument(token, nestedUrl(env, uid, projectId, "views", "catalog"), catalog);
}

export async function readCatalog(
  token: string,
  env: Env,
  uid: string,
  projectId: string,
): Promise<Record<string, unknown> | null> {
  const document = await getDocument(token, nestedUrl(env, uid, projectId, "views", "catalog"));
  return document ? decodeFirestoreDocument(document) : null;
}

export async function writePlan(
  token: string,
  env: Env,
  uid: string,
  plan: Record<string, unknown>,
): Promise<void> {
  const id = String(plan.token ?? "");
  if (!id) throw new FirestoreError("Plan token is required.", 400);
  await patchDocument(token, userDocUrl(env, uid, "plans", id), plan, true);
}

export async function readPlan(
  token: string,
  env: Env,
  uid: string,
  planId: string,
): Promise<Record<string, unknown> | null> {
  const document = await getDocument(token, userDocUrl(env, uid, "plans", planId));
  return document ? decodeFirestoreDocument(document) : null;
}

export function projectMetadata(record: ProjectRecord): Record<string, unknown> {
  return {
    project_id: record.projectId,
    project_name: record.projectName,
    revision: record.revision,
    created_at: record.createdAt,
    updated_at: record.updatedAt,
    plaintext_sha256: record.plaintextSha256,
    ciphertext_bytes: record.ciphertextBytes,
  };
}

export async function refreshFirebaseIdToken(
  refreshToken: string,
  apiKey: string,
): Promise<string> {
  if (!refreshToken || refreshToken.length > 8192 || !apiKey || apiKey.length > 256) {
    throw new FirestoreError("Firebase refresh credential is invalid.", 401);
  }
  const response = await fetch(
    "https://securetoken.googleapis.com/v1/token?key=" + encodeURIComponent(apiKey),
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    },
  );
  if (!response.ok) throw new FirestoreError("Firebase session has expired.", 401);
  let payload: { id_token?: string };
  try {
    payload = (await response.json()) as typeof payload;
  } catch {
    throw new FirestoreError("Firebase session response is invalid.", 502);
  }
  if (!payload.id_token || payload.id_token.length > 8192) {
    throw new FirestoreError("Firebase session could not be refreshed.", 401);
  }
  return payload.id_token;
}
