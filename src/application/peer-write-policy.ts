import fs from "node:fs";
import path from "node:path";

export const PEER_WRITE_ROOTS_ENV = "HARNESS_PEER_WRITE_ROOTS";

export type PeerWritePolicy = {
  configured: boolean;
  roots: string[];
};

export type PeerWritePolicyResult = PeerWritePolicy & {
  allowed: boolean;
  targetPath: string;
};

function canonicalDirectory(input: string, label: string): string {
  if (!path.isAbsolute(input)) {
    throw new Error(`${label} must be an absolute path: ${input}`);
  }
  let canonical: string;
  try {
    canonical = fs.realpathSync.native(input);
  } catch {
    throw new Error(`${label} does not exist or cannot be resolved: ${input}`);
  }
  if (!fs.statSync(canonical).isDirectory()) {
    throw new Error(`${label} must be a directory: ${input}`);
  }
  return canonical;
}

export function readPeerWritePolicy(
  env: NodeJS.ProcessEnv = process.env,
): PeerWritePolicy {
  const raw = env[PEER_WRITE_ROOTS_ENV];
  if (raw === undefined || raw.trim() === "") {
    return { configured: false, roots: [] };
  }

  const entries = raw.split(path.delimiter).map((entry) => entry.trim());
  if (entries.some((entry) => entry === "")) {
    throw new Error(
      `${PEER_WRITE_ROOTS_ENV} contains an empty path; separate existing absolute roots with ${JSON.stringify(path.delimiter)}.`,
    );
  }

  const roots = entries.map((entry) =>
    canonicalDirectory(entry, `${PEER_WRITE_ROOTS_ENV} root`),
  );
  return { configured: true, roots: [...new Set(roots)] };
}

function isWithinRoot(targetPath: string, root: string): boolean {
  const relative = path.relative(root, targetPath);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

export function checkPeerReportWritePolicy(
  targetPath: string,
  env: NodeJS.ProcessEnv = process.env,
): PeerWritePolicyResult {
  const policy = readPeerWritePolicy(env);
  const canonicalTarget = canonicalDirectory(targetPath, "Peer report target");
  return {
    ...policy,
    allowed:
      !policy.configured ||
      policy.roots.some((root) => isWithinRoot(canonicalTarget, root)),
    targetPath: canonicalTarget,
  };
}

export function requirePeerReportWriteAllowed(
  targetPath: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const result = checkPeerReportWritePolicy(targetPath, env);
  if (!result.allowed) {
    throw new Error(
      `Peer report target ${result.targetPath} is outside ${PEER_WRITE_ROOTS_ENV}. Add an enclosing absolute root to the ${path.delimiter === ";" ? "semicolon" : "colon"}-delimited allowlist or unset it to use configured-peer trust.`,
    );
  }
  return result.targetPath;
}
