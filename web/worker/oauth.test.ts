import { afterEach, describe, expect, it, vi } from "vitest";
import { getOAuthHelpers, handleCompatRevoke, handleCompatToken, harnessClientId } from "./oauth";
import { SUPPORTED_SCOPE } from "./protocol";

class MemoryKV {
  private values = new Map<string, string>();

  async get(key: string, options?: { type?: string }): Promise<unknown> {
    const value = this.values.get(key);
    if (value === undefined) return null;
    if (options?.type === "json") return JSON.parse(value);
    return value;
  }

  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }

  async list(options?: { prefix?: string }): Promise<{
    keys: Array<{ name: string }>;
    list_complete: boolean;
    cursor: string;
  }> {
    const prefix = options?.prefix ?? "";
    return {
      keys: Array.from(this.values.keys())
        .filter((key) => key.startsWith(prefix))
        .map((name) => ({ name })),
      list_complete: true,
      cursor: "",
    };
  }
}

function testEnv() {
  return {
    FIREBASE_PROJECT_ID: "harness5",
    FIREBASE_API_KEY: "api-key",
    RATE_LIMIT_SALT: "local-test-salt-with-more-than-32-bytes-123",
    OAUTH_KV: new MemoryKV() as unknown as KVNamespace,
  };
}

function context(): ExecutionContext {
  return { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
}

async function challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("StudyOS-style OAuth/KV adapter", () => {
  it("keeps the CLI alias stable and exchanges JSON compatibility requests through the provider", async () => {
    const env = testEnv();
    const clientId = await harnessClientId(env);
    expect(clientId).not.toBe("harness-cli");
    expect(await harnessClientId(env)).toBe(clientId);

    const verifier = "test-verifier-abcdefghijklmnopqrstuvwxyz-0123456789";
    const redirectUri = "http://127.0.0.1:43123/callback";
    const helper = getOAuthHelpers(env);
    const parsed = await helper.parseAuthRequest(
      new Request(
        "https://worker.example/authorize?" +
          new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: "code",
            code_challenge: await challenge(verifier),
            code_challenge_method: "S256",
            scope: SUPPORTED_SCOPE,
            state: "state-1234567890123456",
          }).toString(),
      ),
    );
    const completed = await helper.completeAuthorization({
      request: parsed,
      userId: "firebase-user-1",
      metadata: { clientName: "test" },
      scope: ["sync:read", "sync:write"],
      props: {
        uid: "firebase-user-1",
        projectId: "harness5",
        firebaseApiKey: "api-key",
        firebaseRefreshToken: "refresh-token",
      },
    });
    const code = new URL(completed.redirectTo).searchParams.get("code") ?? "";
    const tokenResponse = await handleCompatToken(
      new Request("https://worker.example/api/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: "harness-cli",
          redirect_uri: redirectUri,
          code,
          code_verifier: verifier,
        }),
      }),
      env,
      context(),
    );
    expect(tokenResponse.status).toBe(200);
    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token: string;
    };
    expect(tokens.access_token).toBeTruthy();
    expect(tokens.refresh_token).toBeTruthy();

    const revokeResponse = await handleCompatRevoke(
      new Request("https://worker.example/api/oauth/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: "harness-cli",
          refresh_token: tokens.refresh_token,
        }),
      }),
      env,
      context(),
    );
    expect(revokeResponse.status).toBe(200);
    await expect(helper.unwrapToken(tokens.access_token)).resolves.toBeNull();
  });
});
