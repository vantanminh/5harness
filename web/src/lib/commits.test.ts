import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  changeVerb,
  commitAuthor,
  commitClient,
  filesChanged,
  shortCommitId,
} from "./commits";

describe("commit detail helpers", () => {
  it("formats GitHub-like commit metadata", () => {
    const commit = {
      id: "abc123def4567890",
      created_at: "2026-09-16T00:00:00.000Z",
      author_email: "user@example.com",
      client_name: "harness-cli",
      client_version: "0.30.0",
      source: "workstation",
      message: "Auto-sync durable Harness changes",
      changed_paths: [
        { path: "docs/stories/US-001.md", change: "added" as const },
        { path: "docs/intakes/IN-001.md", change: "modified" as const },
      ],
    };
    expect(shortCommitId(commit.id)).toBe("abc123d");
    expect(commitAuthor(commit)).toBe("user@example.com");
    expect(commitClient(commit)).toContain("harness-cli 0.30.0");
    expect(commitClient(commit)).toContain("workstation");
    expect(filesChanged(commit)).toBe(2);
    expect(changeVerb("added")).toBe("added");
  });

  it("dashboard source includes a commit-detail route", () => {
    const app = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "App.tsx"),
      "utf8",
    );
    expect(app).toContain("/projects/:projectId/commits/:commitId");
    expect(app).toContain("CommitDetailPage");
    expect(app).toContain("changed_paths");
    expect(app).toContain("5harness.knotree.com");
  });
});
