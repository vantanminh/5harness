import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { addStoryMd } from "../src/application/md-durable.js";
import {
  formatProposals,
  generateProposals,
  proposeFromProject,
} from "../src/application/propose.js";
import { listTools } from "../src/domain/tools.js";
import { runAudit } from "../src/application/quality.js";
import { asString } from "../src/domain/frontmatter.js";
import { listEntityFiles } from "../src/infrastructure/entities.js";

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
  it("generates proposals from audit and can commit to backlog MD", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-propose-"));
    tempDirs.push(dir);
    addStoryMd(
      { projectRoot: dir },
      {
        id: "US-ORPHAN",
        title: "Needs a trace",
        lane: "normal",
        verify: 'node -e "process.exit(0)"',
      },
    );

    const audit = runAudit(dir);
    expect(audit.orphanedStories.length).toBeGreaterThan(0);
    const proposals = generateProposals(audit);
    expect(proposals.length).toBeGreaterThan(0);
    expect(formatProposals(proposals)).toContain("Proposal");

    const first = proposeFromProject(dir, { commit: true });
    expect(first.committed).toBeGreaterThan(0);
    const title = first.proposals[0]!.title;
    const second = proposeFromProject(dir, { commit: true });
    const count = listEntityFiles(dir, "backlog").filter(
      (f) => asString(f.data, "title") === title,
    ).length;
    expect(count).toBe(1);
    expect(second.proposals.length).toBeGreaterThan(0);
  });

  it("reports clean audit as no proposals", () => {
    const text = formatProposals([]);
    expect(text).toMatch(/No proposals/i);
  });
});
