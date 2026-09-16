import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEVICE_GRANT_TYPE,
  handleCompatRevoke,
  handleCompatToken,
  handleDeviceCode,
  handleDeviceToken,
  handleOAuthRequest,
  getOAuthHelpers,
  harnessClientId,
} from "./oauth";
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

  raw(key: string): string | undefined {
    return this.values.get(key);
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

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("StudyOS-style OAuth/KV adapter", () => {
  it("creates a PKCE-bound device code and returns pending/slow-down responses", async () => {
    const env = testEnv();
    const verifier = "device-verifier-abcdefghijklmnopqrstuvwxyz-0123456789";
    const codeChallenge = await challenge(verifier);
    const response = await handleDeviceCode(
      new Request("https://worker.example/oauth/device/code", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: "harness-cli",
          scope: SUPPORTED_SCOPE,
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
        }),
      }),
      env,
    );
    expect(response.status).toBe(200);
    const device = (await response.json()) as {
      device_code: string;
      user_code: string;
      verification_uri: string;
      interval: number;
    };
    expect(device.device_code).toBeTruthy();
    expect(device.user_code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(device.verification_uri).toBe("https://worker.example/device");
    expect(device.interval).toBe(5);

    const tokenRequest = () =>
      new Request("https://worker.example/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: DEVICE_GRANT_TYPE,
          client_id: "harness-cli",
          device_code: device.device_code,
          code_verifier: verifier,
        }),
      });
    const pending = await handleDeviceToken(tokenRequest(), env, context());
    expect(pending.status).toBe(400);
    expect((await pending.json() as { error?: string }).error).toBe("authorization_pending");
    const tooSoon = await handleDeviceToken(tokenRequest(), env, context());
    expect(tooSoon.status).toBe(400);
    expect((await tooSoon.json() as { error?: string }).error).toBe("slow_down");
  });

  it("advertises the device authorization endpoint in OAuth metadata", async () => {
    const env = testEnv();
    const response = await handleOAuthRequest(
      new Request("https://worker.example/.well-known/oauth-authorization-server"),
      env,
      context(),
    );
    expect(response.status).toBe(200);
    const metadata = (await response.json()) as Record<string, unknown>;
    expect(metadata.device_authorization_endpoint).toBe(
      "https://worker.example/oauth/device/code",
    );
    expect(metadata.grant_types_supported).toEqual(
      expect.arrayContaining([DEVICE_GRANT_TYPE]),
    );
  });

  it("exchanges an approved device code through the provider token machinery", async () => {
    const env = testEnv();
    const verifier = "approved-device-verifier-abcdefghijklmnopqrstuvwxyz-0123456789";
    const codeChallenge = await challenge(verifier);
    const response = await handleDeviceCode(
      new Request("https://worker.example/oauth/device/code", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: "harness-cli",
          scope: SUPPORTED_SCOPE,
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
        }),
      }),
      env,
    );
    const device = (await response.json()) as { device_code: string; user_code: string };
    const clientId = await harnessClientId(env);
    const helper = getOAuthHelpers(env);
    const completed = await helper.completeAuthorization({
      request: {
        responseType: "code",
        clientId,
        redirectUri: "http://127.0.0.1/callback",
        scope: ["sync:read", "sync:write"],
        state: "approved-state-1234567890",
        codeChallenge,
        codeChallengeMethod: "S256",
      },
      userId: "firebase-user-approved",
      metadata: { clientName: "test" },
      scope: ["sync:read", "sync:write"],
      props: {
        uid: "firebase-user-approved",
        projectId: "harness5",
        firebaseApiKey: "api-key",
        firebaseRefreshToken: "refresh-token",
      },
    });
    const authCode = new URL(completed.redirectTo).searchParams.get("code") ?? "";
    const kv = env.OAUTH_KV as unknown as MemoryKV;
    const userCodeHash = await sha256Hex(device.user_code.replace("-", ""));
    const deviceCodeHash = kv.raw("oauth:device-user:" + userCodeHash) ?? "";
    const record = JSON.parse(kv.raw("oauth:device:" + deviceCodeHash) ?? "{}");
    record.status = "approved";
    record.authCode = authCode;
    await env.OAUTH_KV.put("oauth:device:" + deviceCodeHash, JSON.stringify(record));

    const tokenResponse = await handleDeviceToken(
      new Request("https://worker.example/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: DEVICE_GRANT_TYPE,
          client_id: "harness-cli",
          device_code: device.device_code,
          code_verifier: verifier,
        }),
      }),
      env,
      context(),
    );
    expect(tokenResponse.status).toBe(200);
    expect((await tokenResponse.json() as { access_token?: string }).access_token).toBeTruthy();
    expect(kv.raw("oauth:device-user:" + userCodeHash)).toBeUndefined();
  });

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
