import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  addStoryMd,
  updateStoryMd,
} from "../src/application/md-durable.js";
import {
  addTrace,
  runAudit,
  scoreTraceById,
  verifyStory,
} from "../src/application/quality.js";
import { parseFrontmatter } from "../src/domain/frontmatter.js";
import { listLocalTraces } from "../src/application/local-traces.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-quality-"));
  tempDirs.push(dir);
  return dir;
}

describe("quality on markdown store (US-012)", () => {
  it("verifies story pass/fail and writes frontmatter", () => {
    const dir = tempProject();
    addStoryMd(
      { projectRoot: dir },
      {
        id: "US-V1",
        title: "Verify pass",
        lane: "tiny",
        verify: 'node -e "process.exit(0)"',
      },
    );
    addStoryMd(
      { projectRoot: dir },
      {
        id: "US-V2",
        title: "Verify fail",
        lane: "tiny",
        verify: 'node -e "process.exit(2)"',
      },
    );

    const pass = verifyStory(dir, "US-V1");
    expect(pass.pass).toBe(true);
    expect(pass.skipped).toBe(false);

    const fail = verifyStory(dir, "US-V2");
    expect(fail.pass).toBe(false);

    const content = fs.readFileSync(
      path.join(dir, "docs", "stories", "US-V1.md"),
      "utf8",
    );
    const { data } = parseFrontmatter(content);
    expect(data.last_verified_result).toBe("pass");
    expect(data.last_verified_at).toBeTruthy();
  });

  it("records local traces, scores, and audits without harness.db", () => {
    const dir = tempProject();
    addStoryMd(
      { projectRoot: dir },
      {
        id: "US-A1",
        title: "Orphan planned",
        lane: "normal",
        verify: 'node -e "process.exit(0)"',
      },
    );

    const { id } = addTrace(dir, {
      summary: "did work",
      outcome: "completed",
      changed: "src/x.ts",
      story: "US-A1",
      agent: "test",
      actions: "code",
      read: "README.md",
      friction: "none",
    });

    expect(fs.existsSync(path.join(dir, "harness.db"))).toBe(false);
    expect(listLocalTraces(dir)).toHaveLength(1);
    expect(
      fs.existsSync(path.join(dir, ".5harness", "local", "traces.jsonl")),
    ).toBe(true);

    updateStoryMd(
      { projectRoot: dir },
      { id: "US-A1", status: "in_progress" },
    );

    const score = scoreTraceById(dir, id);
    expect(score.achieved).toBe("standard");

    // still unverified until verify
    let audit = runAudit(dir);
    expect(audit.unverifiedStories.some((s) => s.id === "US-A1")).toBe(true);
    // has trace so not orphaned
    expect(audit.orphanedStories.some((s) => s.id === "US-A1")).toBe(false);

    verifyStory(dir, "US-A1");
    audit = runAudit(dir);
    expect(audit.unverifiedStories.some((s) => s.id === "US-A1")).toBe(false);
  });
});
