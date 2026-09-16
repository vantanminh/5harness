import { afterEach, describe, expect, it, vi } from "vitest";
import {
  decodeFirestoreValue,
  encodeFirestoreFields,
  listProjects,
  readProject,
  upsertProject,
} from "./firestore";

const envelope = {
  schema_version: 1,
  format: "harness-sync-envelope",
  project_id: "project-1234567890",
  project_name: "Harness",
  plaintext_sha256: "a".repeat(64),
  kdf: "PBKDF2-HMAC-SHA256",
  iterations: 310000,
  salt_base64: "AAAAAAAAAAAAAAAAAAAAAA==",
  cipher: "AES-256-GCM",
  nonce_base64: "AAAAAAAAAAAAAAAA",
  ciphertext_base64: "AAAAAAAAAAAAAAAAAAAAAA==",
  created_at: "2026-09-16T00:00:00.000Z",
};

const env = {
  FIREBASE_PROJECT_ID: "harness5",
  FIREBASE_API_KEY: "api-key",
  OAUTH_KV: {} as KVNamespace,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Firestore REST adapter", () => {
  it("encodes nested values and decodes Firestore scalar types", () => {
    expect(
      encodeFirestoreFields({
        envelope,
        count: 2,
        optional: undefined,
      }),
    ).toMatchObject({
      count: { integerValue: "2" },
      envelope: { mapValue: { fields: { project_id: { stringValue: "project-1234567890" } } } },
    });
    expect(
      decodeFirestoreValue({
        mapValue: {
          fields: {
            title: { stringValue: "Harness" },
            done: { booleanValue: true },
            count: { integerValue: "3" },
            tags: { arrayValue: { values: [{ stringValue: "sync" }] } },
          },
        },
      }),
    ).toEqual({ title: "Harness", done: true, count: 3, tags: ["sync"] });
  });

  it("passes the Firebase bearer token to the user-scoped REST path", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain(
        "/projects/harness5/databases/(default)/documents/users/user-1/projects/project-1234567890",
      );
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        "Bearer firebase-token",
      );
      return Response.json({
        updateTime: "2026-09-16T00:00:00.000000Z",
        fields: {
          projectId: { stringValue: "project-1234567890" },
          projectName: { stringValue: "Harness" },
          revision: { stringValue: "revision-1" },
          envelope: { mapValue: { fields: encodeFirestoreFields(envelope) } },
          plaintextSha256: { stringValue: "a".repeat(64) },
          ciphertextBytes: { integerValue: "16" },
          createdAt: { timestampValue: "2026-09-16T00:00:00.000Z" },
          updatedAt: { timestampValue: "2026-09-16T00:00:00.000Z" },
          expiresAt: { timestampValue: "2099-09-16T00:00:00.000Z" },
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await readProject(
      "firebase-token",
      env,
      "user-1",
      "project-1234567890",
    );
    expect(result?.projectId).toBe("project-1234567890");
    expect(result?.revision).toBe("revision-1");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("lists, sorts, and removes expired project documents without a TTL field override", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "DELETE") return new Response(null, { status: 204 });
      expect(url).toContain(
        "/projects/harness5/databases/(default)/documents/users/user-1/projects",
      );
      return Response.json({
        documents: [
          {
            name: "expired",
            fields: {
              projectId: { stringValue: "project-expired-123" },
              projectName: { stringValue: "Expired" },
              updatedAt: { timestampValue: "2025-01-01T00:00:00.000Z" },
              expiresAt: { timestampValue: "2025-01-02T00:00:00.000Z" },
            },
          },
          {
            name: "live",
            fields: {
              projectId: { stringValue: "project-live-123456" },
              projectName: { stringValue: "Live" },
              updatedAt: { timestampValue: "2099-01-01T00:00:00.000Z" },
              expiresAt: { timestampValue: "2099-02-01T00:00:00.000Z" },
            },
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const projects = await listProjects("firebase-token", env, "user-1");
    expect(projects.map((project) => project.projectId)).toEqual([
      "project-live-123456",
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("writes with Firestore updateTime compare-and-swap", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (!init?.method || init.method === "GET") {
        return Response.json({
          updateTime: "2026-09-16T00:00:00.000000Z",
          fields: {
            projectId: { stringValue: "project-1234567890" },
            projectName: { stringValue: "Harness" },
            revision: { stringValue: "revision-1" },
            createdAt: { timestampValue: "2026-09-15T00:00:00.000Z" },
            expiresAt: { timestampValue: "2099-09-16T00:00:00.000Z" },
          },
        });
      }
      expect(init.method).toBe("PATCH");
      expect(url.searchParams.get("currentDocument.updateTime")).toBe(
        "2026-09-16T00:00:00.000000Z",
      );
      expect(new Headers(init.headers).get("Authorization")).toBe(
        "Bearer firebase-token",
      );
      return Response.json({
        updateTime: "2026-09-16T00:01:00.000000Z",
        fields: encodeFirestoreFields({
          projectId: "project-1234567890",
          projectName: "Harness",
          revision: "revision-2",
          envelope,
          plaintextSha256: envelope.plaintext_sha256,
          ciphertextBytes: 16,
          createdAt: "2026-09-15T00:00:00.000Z",
          updatedAt: "2026-09-16T00:01:00.000Z",
          expiresAt: "2099-09-16T00:00:00.000Z",
        }),
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await upsertProject(
      "firebase-token",
      env,
      "user-1",
      "project-1234567890",
      "Harness",
      envelope,
      "revision-1",
    );
    expect(result.record.revision).toBe("revision-2");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
