import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { addStory, updateStory } from "../src/application/durable.js";
import {
  addTrace,
  runAudit,
  scoreTraceById,
  verifyStory,
} from "../src/application/quality.js";
import { openExistingHarnessDb } from "../src/infrastructure/context.js";
import { runInit } from "../src/infrastructure/scaffold.js";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-quality-"));
  tempDirs.push(dir);
  runInit({ directory: dir, packageRoot });
  return dir;
}

describe("quality application layer", () => {
  it("verifies story pass and fail", () => {
    const dir = tempProject();
    const { db } = openExistingHarnessDb({ directory: dir, packageRoot });
    try {
      addStory(db, {
        id: "US-V1",
        title: "Verify pass",
        lane: "tiny",
        verify: "node -e \"process.exit(0)\"",
      });
      addStory(db, {
        id: "US-V2",
        title: "Verify fail",
        lane: "tiny",
        verify: "node -e \"process.exit(2)\"",
      });

      const pass = verifyStory(db, "US-V1", dir);
      expect(pass.pass).toBe(true);
      expect(pass.skipped).toBe(false);

      const fail = verifyStory(db, "US-V2", dir);
      expect(fail.pass).toBe(false);

      const row = db
        .prepare(
          "SELECT last_verified_result FROM story WHERE id = ?",
        )
        .get("US-V1") as { last_verified_result: string };
      expect(row.last_verified_result).toBe("pass");
    } finally {
      db.close();
    }
  });

  it("records trace, scores, and audits", () => {
    const dir = tempProject();
    const { db } = openExistingHarnessDb({ directory: dir, packageRoot });
    try {
      addStory(db, {
        id: "US-A1",
        title: "Orphan planned",
        lane: "normal",
        verify: "node -e \"process.exit(0)\"",
      });
      // leave planned, no trace, never verified -> audit hits

      const { id } = addTrace(db, {
        summary: "did work",
        outcome: "completed",
        changed: "src/x.ts",
        story: "US-A1",
        agent: "test",
        actions: "code",
        read: "README.md",
        friction: "none",
      });

      // after trace, story no longer orphaned but still unverified until verify
      updateStory(db, { id: "US-A1", status: "in_progress" });

      const score = scoreTraceById(db, id);
      expect(score.achieved).toBe("standard");

      verifyStory(db, "US-A1", dir);
      const audit = runAudit(db);
      expect(audit.unverifiedStories.find((s) => s.id === "US-A1")).toBeUndefined();
      expect(audit.entropyScore).toBeGreaterThanOrEqual(0);
    } finally {
      db.close();
    }
  });
});
