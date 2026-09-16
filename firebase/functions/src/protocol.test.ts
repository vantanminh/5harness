import { describe, expect, it } from "vitest";
import {
  CLIENT_ID,
  isValidProjectId,
  isValidProxyToken,
  isValidRedirectUri,
  validateAuthorizeRequest,
  validateEnvelope,
} from "./protocol.js";

const envelope = {
  schema_version: 1,
  format: "harness-sync-envelope",
  project_id: "project-1234567890",
  project_name: "demo",
  plaintext_sha256: "a".repeat(64),
  kdf: "PBKDF2-HMAC-SHA256",
  iterations: 310000,
  salt_base64: Buffer.alloc(16).toString("base64"),
  cipher: "AES-256-GCM",
  nonce_base64: Buffer.alloc(12).toString("base64"),
  ciphertext_base64: Buffer.alloc(32).toString("base64"),
  created_at: new Date().toISOString(),
};

describe("cloud sync protocol validation", () => {
  it("accepts only opaque project ids and loopback callback URLs", () => {
    expect(isValidProjectId("project-1234567890")).toBe(true);
    expect(isValidProjectId("../secrets")).toBe(false);
    expect(isValidRedirectUri("http://127.0.0.1:43123/callback")).toBe(true);
    expect(isValidRedirectUri("https://127.0.0.1:43123/callback")).toBe(false);
    expect(isValidRedirectUri("http://127.0.0.1:43123/callback?code=leak")).toBe(false);
  });

  it("requires exact PKCE authorization parameters", () => {
    const request = {
      client_id: CLIENT_ID,
      redirect_uri: "http://127.0.0.1:43123/callback",
      response_type: "code",
      code_challenge: "a".repeat(43),
      code_challenge_method: "S256",
      scope: "sync:read sync:write",
      state: "state-value-with-enough-length",
    };
    expect(validateAuthorizeRequest(request)).toBeNull();
    expect(validateAuthorizeRequest({ ...request, code_challenge_method: "plain" })).toBe(
      "invalid_code_challenge",
    );
    expect(validateAuthorizeRequest({ ...request, client_id: "attacker" })).toBe("invalid_client");
  });

  it("accepts a bounded encrypted envelope and rejects a forged project", () => {
    expect(validateEnvelope(envelope, envelope.project_id)).toBe(true);
    expect(
      validateEnvelope({ ...envelope, project_id: "other-project-123456" }, envelope.project_id),
    ).toBe(false);
    expect(
      validateEnvelope({ ...envelope, ciphertext_base64: "not-base64" }, envelope.project_id),
    ).toBe(false);
  });

  it("requires the private Pages proxy token", () => {
    const configured = "proxy-secret-that-is-at-least-32-chars";
    expect(isValidProxyToken(configured, configured)).toBe(true);
    expect(isValidProxyToken("attacker", configured)).toBe(false);
    expect(isValidProxyToken(configured, "short")).toBe(false);
  });
});
