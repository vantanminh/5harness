export type SyncFile = {
  path: string;
  sha256: string;
  content_base64: string;
};

export type SyncManifest = {
  schema_version: number;
  project_id: string;
  generated_at: string;
  files: SyncFile[];
};

export type EncryptedEnvelope = {
  schema_version: number;
  format: string;
  project_id: string;
  project_name: string;
  plaintext_sha256: string;
  kdf: string;
  iterations: number;
  salt_base64: string;
  cipher: string;
  nonce_base64: string;
  ciphertext_base64: string;
  created_at: string;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const allowedRoots = [
  "docs/stories/",
  "docs/decisions/",
  "docs/intakes/",
  "docs/backlog/",
  "docs/reports/",
];

export async function decryptEnvelope(
  envelope: EncryptedEnvelope,
  passphrase: string,
): Promise<SyncManifest> {
  if (
    envelope.schema_version !== 1 ||
    envelope.format !== "harness-sync-envelope" ||
    envelope.kdf !== "PBKDF2-HMAC-SHA256" ||
    envelope.cipher !== "AES-256-GCM" ||
    envelope.iterations < 100_000 ||
    envelope.iterations > 2_000_000
  ) {
    throw new Error("Unsupported or unsafe encrypted snapshot format.");
  }
  if (passphrase.length < 12) {
    throw new Error("Passphrase must contain at least 12 characters.");
  }
  const salt = fromBase64(envelope.salt_base64);
  const nonce = fromBase64(envelope.nonce_base64);
  const ciphertext = fromBase64(envelope.ciphertext_base64);
  if (salt.byteLength !== 16 || nonce.byteLength !== 12 || ciphertext.byteLength < 16) {
    throw new Error("Encrypted snapshot has invalid cryptographic fields.");
  }
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    asBufferSource(encoder.encode(passphrase)),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: asBufferSource(salt),
      iterations: envelope.iterations,
      hash: "SHA-256",
    },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"],
  );
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: asBufferSource(nonce),
        additionalData: asBufferSource(encoder.encode(envelope.project_id)),
        tagLength: 128,
      },
      key,
      asBufferSource(ciphertext),
    );
  } catch {
    throw new Error("Unable to decrypt snapshot. Check the passphrase.");
  }
  const plaintextHash = await sha256Hex(new Uint8Array(plaintext));
  if (plaintextHash !== envelope.plaintext_sha256) {
    throw new Error("Snapshot integrity check failed.");
  }
  let manifest: SyncManifest;
  try {
    manifest = JSON.parse(decoder.decode(plaintext)) as SyncManifest;
  } catch {
    throw new Error("Decrypted snapshot manifest is invalid.");
  }
  await validateManifest(manifest, envelope.project_id);
  return manifest;
}

export async function validateManifest(
  manifest: SyncManifest,
  projectId: string,
): Promise<void> {
  if (
    manifest.schema_version !== 1 ||
    manifest.project_id !== projectId ||
    !Array.isArray(manifest.files) ||
    manifest.files.length > 10_000
  ) {
    throw new Error("Snapshot manifest schema or project identity is invalid.");
  }
  const paths = new Set<string>();
  let totalBytes = 0;
  for (const file of manifest.files) {
    if (
      typeof file.path !== "string" ||
      !allowedRoots.some((root) => file.path.startsWith(root)) ||
      file.path.includes("\\") ||
      file.path.includes("..") ||
      !file.path.toLowerCase().endsWith(".md") ||
      file.path.toLowerCase().endsWith("/readme.md") ||
      paths.has(file.path)
    ) {
      throw new Error("Snapshot contains an unsafe or duplicate path.");
    }
    paths.add(file.path);
    const content = fromBase64(file.content_base64);
    if ((await sha256Hex(content)) !== file.sha256) {
      throw new Error("Snapshot file hash mismatch: " + file.path);
    }
    totalBytes += content.byteLength;
    if (totalBytes > 700 * 1024) {
      throw new Error("Snapshot plaintext exceeds the allowed size.");
    }
  }
}

function fromBase64(value: string): Uint8Array {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error("Snapshot base64 field is invalid.");
  }
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function sha256Hex(value: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", asBufferSource(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function asBufferSource(value: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}
