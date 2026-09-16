import { describe, expect, it } from "vitest";
import { validateCommitInput } from "./commits";

const change = {
  path: "docs/stories/US-001.md",
  change: "added" as const,
  sha256: "a".repeat(64),
};

describe("sync commit validation", () => {
  it("accepts a GitHub-like commit and binds the authenticated author", () => {
    const commit = validateCommitInput(
      {
        id: "abc123def4567890",
        parent_id: null,
        created_at: "2026-09-16T00:00:00.000Z",
        message: "Auto-sync durable Harness changes",
        client_name: "harness-cli",
        client_version: "0.30.0",
        source: "workstation",
        changed_paths: [change],
        author_user_id: "spoof",
      },
      { authorUserId: "firebase-user-1", authorEmail: "user@example.com" },
    );
    expect(commit?.id).toBe("abc123def4567890");
    expect(commit?.author_user_id).toBe("firebase-user-1");
    expect(commit?.author_email).toBe("user@example.com");
    expect(commit?.changed_paths).toEqual([change]);
    expect(commit?.client_name).toBe("harness-cli");
  });

  it("rejects source-tree paths and missing change hashes", () => {
    expect(
      validateCommitInput(
        {
          id: "abc123def4567890",
          changed_paths: [{ path: "src/main.rs", change: "added", sha256: "a".repeat(64) }],
        },
        { authorUserId: "firebase-user-1" },
      ),
    ).toBeNull();
    expect(
      validateCommitInput(
        {
          id: "abc123def4567890",
          changed_paths: [{ path: "docs/stories/US-001.md", change: "modified" }],
        },
        { authorUserId: "firebase-user-1" },
      ),
    ).toBeNull();
  });
});
