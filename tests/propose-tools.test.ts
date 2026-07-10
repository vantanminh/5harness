import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { addStory } from "../src/application/durable.js";
import {
  formatProposals,
  generateProposals,
  proposeFromDb,
} from "../src/application/propose.js";
import { listTools } from "../src/domain/tools.js";
import { openExistingHarnessDb } from "../src/infrastructure/context.js";
import { runInit } from "../src/infrastructure/scaffold.js";
import { runAudit } from "../src/application/quality.js";

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

describe("listTools", () => {
  it("returns builtin tools and filters by capability", () => {
    const all = listTools();
    expect(all.length).toBeGreaterThan(10);
    expect(all.some((t) => t.name === "query tools")).toBe(true);
    const ver = listTools({ capability: "verification" });
    expect(ver.every((t) => t.capability === "verification")).toBe(true);
    expect(ver.some((t) => t.name === "story verify")).toBe(true);
  });
});

describe("propose", () => {
  it("generates proposals from audit and can commit to backlog", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-propose-"));
    tempDirs.push(dir);
    runInit({ directory: dir, packageRoot });
    const { db } = openExistingHarnessDb({ directory: dir, packageRoot });
    try {
      addStory(db, {
        id: "US-ORPHAN",
        title: "Needs a trace",
        lane: "normal",
        verify: "node -e \"process.exit(0)\"",
      });
      // planned + verify never passed + no trace => proposals

      const audit = runAudit(db);
      expect(audit.orphanedStories.length).toBeGreaterThan(0);
      const proposals = generateProposals(audit);
      expect(proposals.length).toBeGreaterThan(0);
      expect(formatProposals(proposals)).toContain("Proposal");

      const first = proposeFromDb(db, { commit: true });
      expect(first.committed).toBeGreaterThan(0);
      const title = first.proposals[0]!.title;
      const second = proposeFromDb(db, { commit: true });
      // same titles are not duplicated; new findings (e.g. open backlog
      // without outcomes created by the first commit) may still add rows
      const count = db
        .prepare(`SELECT COUNT(*) AS n FROM backlog WHERE title = ?`)
        .get(title) as { n: number };
      expect(count.n).toBe(1);
      expect(second.proposals.length).toBeGreaterThan(0);
    } finally {
      db.close();
    }
  });

  it("reports clean audit as no proposals", () => {
    const text = formatProposals([]);
    expect(text).toMatch(/No proposals/i);
  });
});
