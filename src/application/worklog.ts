import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export type WorklogEntry = {
  id: number;
  created_at: string;
  story_id: string;
  summary: string;
  pr: string | null;
  commit: string | null;
  evidence: string | null;
};

function worklogPath(projectRoot: string): string {
  return path.join(projectRoot, ".harness", "worklog.jsonl");
}

export function listWorklog(projectRoot: string): WorklogEntry[] {
  const p = worklogPath(projectRoot);
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, "utf8").split(/\r?\n/).filter(Boolean);
  const out: WorklogEntry[] = [];
  for (const line of lines) {
    try {
      out.push(JSON.parse(line) as WorklogEntry);
    } catch { /* skip corrupt lines */ }
  }
  return out;
}

function nextId(projectRoot: string): number {
  const items = listWorklog(projectRoot);
  let max = 0;
  for (const item of items) {
    if (item.id > max) max = item.id;
  }
  return max + 1;
}

export function addWorklog(
  projectRoot: string,
  input: {
    story_id: string;
    summary: string;
    pr?: string;
    commit?: string;
    evidence?: string;
  },
): WorklogEntry {
  const dir = path.dirname(worklogPath(projectRoot));
  fs.mkdirSync(dir, { recursive: true });

  const entry: WorklogEntry = {
    id: nextId(projectRoot),
    created_at: new Date().toISOString(),
    story_id: input.story_id,
    summary: input.summary,
    pr: input.pr ?? null,
    commit: input.commit ?? null,
    evidence: input.evidence ?? null,
  };

  fs.appendFileSync(worklogPath(projectRoot), JSON.stringify(entry) + "\n", "utf8");
  return entry;
}

export function worklogFromGit(
  projectRoot: string,
  storyId: string,
  since?: string,
): WorklogEntry[] {
  const args = ["-C", projectRoot, "log", "--oneline", "--no-decorate"];
  if (since) args.push(`--since=${since}`);
  args.push("-n", "10");

  let commits: string[] = [];
  try {
    const result = spawnSync("git", args, {
      encoding: "utf8",
      windowsHide: true,
      timeout: 10000,
    });
    if (result.status === 0 && result.stdout.trim()) {
      commits = result.stdout.trim().split(/\r?\n/);
    }
  } catch { /* git unavailable */ }

  if (commits.length === 0) return [];

  const entries: WorklogEntry[] = [];
  for (const line of commits) {
    // format: <short-hash> <message>
    const match = line.match(/^([a-f0-9]{7,})\s+(.+)$/);
    if (!match) continue;
    const [, hash, message] = match;
    if (!hash || !message) continue;
    entries.push(
      addWorklog(projectRoot, {
        story_id: storyId,
        summary: message.trim(),
        commit: hash,
      }),
    );
  }
  return entries;
}

export function formatWorklog(entries: WorklogEntry[], json: boolean): string {
  if (json) {
    return JSON.stringify(entries, null, 2);
  }
  if (entries.length === 0) return "No worklog entries.";
  return entries
    .map((e) => {
      const parts = [`[${e.id}] ${e.created_at.slice(0, 19)}`];
      parts.push(`story: ${e.story_id}`);
      if (e.pr) parts.push(`PR: ${e.pr}`);
      if (e.commit) parts.push(`commit: ${e.commit}`);
      parts.push(e.summary);
      return parts.join("  ");
    })
    .join("\n");
}
