import { webcrypto } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptEnvelope, validateManifest, type EncryptedEnvelope, type SyncManifest } from "./envelope";

const browserCrypto = webcrypto;
const textEncoder = new TextEncoder();

describe("cloud snapshot browser decryption", () => {
  it("decrypts the AES-GCM/PBKDF2 envelope produced by the CLI contract", async () => {
    const projectId = "project-1234567890";
    const content = Buffer.from("# Hello from Harness\n");
    const manifest: SyncManifest = {
      schema_version: 1,
      project_id: projectId,
      generated_at: "2026-01-01T00:00:00.000Z",
      files: [{
        path: "docs/stories/US-001.md",
        sha256: await digestHex(content),
        content_base64: content.toString("base64"),
      }],
    };
    const plaintext = textEncoder.encode(JSON.stringify(manifest));
    const salt = new Uint8Array(16).fill(7);
    const nonce = new Uint8Array(12).fill(9);
    const passwordKey = await browserCrypto.subtle.importKey(
      "raw",
      textEncoder.encode("a long enough passphrase"),
      "PBKDF2",
      false,
      ["deriveKey"],
    );
    const key = await browserCrypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256" },
      passwordKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt"],
    );
    const ciphertext = await browserCrypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce, additionalData: textEncoder.encode(projectId), tagLength: 128 },
      key,
      plaintext,
    );
    const envelope: EncryptedEnvelope = {
      schema_version: 1,
      format: "harness-sync-envelope",
      project_id: projectId,
      project_name: "demo",
      plaintext_sha256: await digestHex(plaintext),
      kdf: "PBKDF2-HMAC-SHA256",
      iterations: 310000,
      salt_base64: Buffer.from(salt).toString("base64"),
      cipher: "AES-256-GCM",
      nonce_base64: Buffer.from(nonce).toString("base64"),
      ciphertext_base64: Buffer.from(ciphertext).toString("base64"),
      created_at: "2026-01-01T00:00:00.000Z",
    };
    await expect(decryptEnvelope(envelope, "a long enough passphrase")).resolves.toEqual(manifest);
    await expect(decryptEnvelope(envelope, "wrong passphrase")).rejects.toThrow("Unable to decrypt");
  });

  it("rejects path traversal and duplicate files before rendering content", async () => {
    const valid: SyncManifest = {
      schema_version: 1,
      project_id: "project-1234567890",
      generated_at: "2026-01-01T00:00:00.000Z",
      files: [],
    };
    await expect(validateManifest(valid, valid.project_id)).resolves.toBeUndefined();
    await expect(validateManifest({
      ...valid,
      files: [{ path: "docs/stories/../AGENTS.md", sha256: "a".repeat(64), content_base64: "" }],
    }, valid.project_id)).rejects.toThrow("unsafe");
  });
});

async function digestHex(value: Uint8Array): Promise<string> {
  const digest = await browserCrypto.subtle.digest("SHA-256", value);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
