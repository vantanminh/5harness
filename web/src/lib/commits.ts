export type CommitChange = {
  path: string;
  change: "added" | "modified" | "deleted" | string;
  sha256?: string | null;
};

export type CloudCommit = {
  id: string;
  parent_id?: string | null;
  created_at: string;
  author_user_id?: string;
  author_email?: string | null;
  client_name?: string;
  client_version?: string;
  source?: string;
  message: string;
  changed_paths?: CommitChange[];
  files_changed?: number;
};

export function shortCommitId(id: string): string {
  return id.slice(0, 7);
}

export function changeVerb(change: string): string {
  if (change === "added") return "added";
  if (change === "deleted") return "deleted";
  return "modified";
}

export function filesChanged(commit: CloudCommit): number {
  return commit.files_changed ?? commit.changed_paths?.length ?? 0;
}

export function commitAuthor(commit: CloudCommit): string {
  return commit.author_email || commit.author_user_id || "unknown";
}

export function commitClient(commit: CloudCommit): string {
  const name = commit.client_name || "harness-cli";
  const version = commit.client_version ? ` ${commit.client_version}` : "";
  const source = commit.source ? ` · ${commit.source}` : "";
  return `${name}${version}${source}`;
}
