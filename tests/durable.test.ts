import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  addBacklog,
  addDecision,
  addIntake,
  addStory,
  closeBacklog,
  queryBacklog,
  queryMatrix,
  queryStats,
  updateStory,
} from "../src/application/durable.js";
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-durable-"));
  tempDirs.push(dir);
  runInit({ directory: dir, packageRoot, createLegacyDb: true, skipRegister: true });
  return dir;
}

describe("durable application layer", () => {
  it("round-trips intake story decision backlog and queries", () => {
    const dir = tempProject();
    const { db } = openExistingHarnessDb({ directory: dir, packageRoot });
    try {
      const intake = addIntake(db, {
        type: "spec_slice",
        summary: "build durable cmds",
        lane: "normal",
        story: "US-010",
      });
      expect(intake.id).toBeGreaterThan(0);

      addStory(db, {
        id: "US-010",
        title: "Durable demo",
        lane: "high-risk",
        contract: "docs/product/overview.md",
      });
      updateStory(db, {
        id: "US-010",
        status: "implemented",
        unit: "1",
        integration: "1",
        e2e: "0",
        platform: "0",
        evidence: "tests",
      });

      addDecision(db, {
        id: "0099-demo",
        title: "Demo decision",
        doc: "docs/decisions/0099.md",
      });

      const backlog = addBacklog(db, {
        title: "Improve docs",
        risk: "tiny",
        predicted: "less friction",
      });
      closeBacklog(db, {
        id: String(backlog.id),
        status: "implemented",
        outcome: "done",
      });

      const matrix = queryMatrix(db, true);
      expect(matrix).toContain("US-010");
      expect(matrix).toMatch(/1\s+1\s+0\s+0/);

      const stats = queryStats(db);
      expect(stats).toContain("intakes");
      expect(stats).toMatch(/1\s+1\s+1\s+1/);

      const closed = queryBacklog(db, "closed");
      expect(closed).toContain("Improve docs");
    } finally {
      db.close();
    }
  });

  it("errors when db is missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-nodb-"));
    tempDirs.push(dir);
    expect(() =>
      openExistingHarnessDb({ directory: dir, packageRoot }),
    ).toThrow(/init/);
  });
});
