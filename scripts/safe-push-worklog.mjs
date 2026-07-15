import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const WORKLOG_RELATIVE_PATH = path.join(".5harness", "worklog.jsonl");

function git(root, args, input, trim = true) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    input,
    windowsHide: true,
    stdio: input === undefined ? "pipe" : ["pipe", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`,
    );
  }
  return trim ? result.stdout.trim() : result.stdout;
}

function patchId(root, hash) {
  const patch = git(root, ["show", "--format=", "--binary", hash], undefined, false);
  if (!patch) return null;
  const output = git(root, ["patch-id", "--stable"], `${patch}\n`);
  return output.split(/\s+/)[0] || null;
}

export function captureRebaseCandidates(root, remoteRef) {
  const output = git(root, ["rev-list", "--reverse", `${remoteRef}..HEAD`]);
  if (!output) return [];
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((hash) => ({ hash, patchId: patchId(root, hash) }))
    .filter((entry) => entry.patchId !== null);
}

export function buildRebaseCommitMap(before, after) {
  const afterByPatch = new Map();
  for (const entry of after) {
    const matches = afterByPatch.get(entry.patchId) ?? [];
    matches.push(entry.hash);
    afterByPatch.set(entry.patchId, matches);
  }

  const offsets = new Map();
  const mapping = new Map();
  for (const entry of before) {
    const matches = afterByPatch.get(entry.patchId) ?? [];
    const offset = offsets.get(entry.patchId) ?? 0;
    const replacement = matches[offset];
    if (replacement) {
      mapping.set(entry.hash, replacement);
      offsets.set(entry.patchId, offset + 1);
    }
  }
  return mapping;
}

function replacementFor(commitRef, mapping) {
  const matches = [...mapping.entries()].filter(
    ([oldHash]) => oldHash === commitRef || oldHash.startsWith(commitRef),
  );
  if (matches.length !== 1) return null;
  const [oldHash, newHash] = matches[0];
  if (oldHash === newHash) return commitRef;
  return commitRef.length >= oldHash.length
    ? newHash
    : newHash.slice(0, commitRef.length);
}

export function rewriteWorklogCommitRefs(worklogPath, mapping) {
  if (!fs.existsSync(worklogPath) || mapping.size === 0) return 0;
  const raw = fs.readFileSync(worklogPath, "utf8");
  const hadFinalNewline = /\r?\n$/.test(raw);
  const lines = raw.split(/\r?\n/);
  if (hadFinalNewline) lines.pop();
  let updated = 0;

  const rewritten = lines.map((line) => {
    if (!line.trim()) return line;
    try {
      const entry = JSON.parse(line);
      if (!entry || typeof entry.commit !== "string" || !entry.commit) {
        return line;
      }
      const replacement = replacementFor(entry.commit, mapping);
      if (!replacement || replacement === entry.commit) return line;
      entry.commit = replacement;
      updated += 1;
      return JSON.stringify(entry);
    } catch {
      return line;
    }
  });

  if (updated > 0) {
    const next = `${rewritten.join("\n")}${hadFinalNewline ? "\n" : ""}`;
    const temp = `${worklogPath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temp, next, "utf8");
    fs.renameSync(temp, worklogPath);
  }
  return updated;
}

export function reconcileWorklogAfterRebase(root, before, after) {
  const mapping = buildRebaseCommitMap(before, after);
  const updated = rewriteWorklogCommitRefs(
    path.join(root, WORKLOG_RELATIVE_PATH),
    mapping,
  );
  return {
    mapped: mapping.size,
    unmatched: Math.max(0, before.length - mapping.size),
    updated,
  };
}
