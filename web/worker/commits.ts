export const MAX_COMMIT_MESSAGE = 500;
export const MAX_COMMIT_SOURCE = 200;
export const MAX_COMMIT_CLIENT = 80;
export const MAX_CHANGED_PATHS = 10_000;

export type CommitChangeType = "added" | "modified" | "deleted";

export interface CommitPathChange {
  path: string;
  change: CommitChangeType;
  sha256: string | null;
}

export interface SyncCommit {
  id: string;
  parent_id: string | null;
  created_at: string;
  author_user_id: string;
  author_email: string | null;
  client_name: string;
  client_version: string;
  source: string;
  message: string;
  changed_paths: CommitPathChange[];
}

const SHA256_RE = /^[a-f0-9]{64}$/;
const COMMIT_ID_RE = /^[a-f0-9]{8,64}$/;
const DURABLE_PATH_RE =
  /^docs\/(stories|decisions|intakes|backlog|reports)\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+\.md$/i;

export function isDurableCommitPath(path: unknown): path is string {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    path.length <= 400 &&
    !path.includes("\\") &&
    !path.includes("..") &&
    DURABLE_PATH_RE.test(path) &&
    !path.toLowerCase().endsWith("/readme.md")
  );
}

export function validateCommitChange(value: unknown): CommitPathChange | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Partial<CommitPathChange>;
  if (!isDurableCommitPath(item.path)) return null;
  if (item.change !== "added" && item.change !== "modified" && item.change !== "deleted") {
    return null;
  }
  if (item.change === "deleted") {
    if (item.sha256 != null && item.sha256 !== "") return null;
    return { path: item.path, change: item.change, sha256: null };
  }
  if (typeof item.sha256 !== "string" || !SHA256_RE.test(item.sha256)) return null;
  return { path: item.path, change: item.change, sha256: item.sha256 };
}

export function validateCommitInput(
  value: unknown,
  fallback: { authorUserId: string; authorEmail?: string | null },
): SyncCommit | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const changed = Array.isArray(raw.changed_paths)
    ? raw.changed_paths.map(validateCommitChange)
    : null;
  if (!changed || changed.some((item) => item === null) || changed.length > MAX_CHANGED_PATHS) {
    return null;
  }
  const changed_paths = changed as CommitPathChange[];
  const message =
    typeof raw.message === "string" && raw.message.trim() && raw.message.length <= MAX_COMMIT_MESSAGE
      ? raw.message.trim()
      : "Sync durable Harness markdown";
  const client_name =
    typeof raw.client_name === "string" && raw.client_name.trim() && raw.client_name.length <= MAX_COMMIT_CLIENT
      ? raw.client_name.trim()
      : "harness-cli";
  const client_version =
    typeof raw.client_version === "string" && raw.client_version.length <= 32
      ? raw.client_version
      : "unknown";
  const source =
    typeof raw.source === "string" && raw.source.trim() && raw.source.length <= MAX_COMMIT_SOURCE
      ? raw.source.trim()
      : "harness-cli";
  const parent_id =
    raw.parent_id == null || raw.parent_id === ""
      ? null
      : typeof raw.parent_id === "string" && COMMIT_ID_RE.test(raw.parent_id)
        ? raw.parent_id
        : null;
  if (raw.parent_id && parent_id === null) return null;
  const created_at =
    typeof raw.created_at === "string" && raw.created_at.length <= 40
      ? raw.created_at
      : new Date().toISOString();
  const id =
    typeof raw.id === "string" && COMMIT_ID_RE.test(raw.id)
      ? raw.id
      : null;
  if (!id) return null;
  return {
    id,
    parent_id,
    created_at,
    author_user_id: fallback.authorUserId,
    author_email: fallback.authorEmail ?? null,
    client_name,
    client_version,
    source,
    message,
    changed_paths,
  };
}

export function commitMetadata(commit: SyncCommit): Record<string, unknown> {
  return {
    id: commit.id,
    parent_id: commit.parent_id,
    created_at: commit.created_at,
    author_user_id: commit.author_user_id,
    author_email: commit.author_email,
    client_name: commit.client_name,
    client_version: commit.client_version,
    source: commit.source,
    message: commit.message,
    changed_paths: commit.changed_paths,
    files_changed: commit.changed_paths.length,
  };
}
