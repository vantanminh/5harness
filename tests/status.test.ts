import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildStatus, formatStatus } from "../src/application/status.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-st-"));
  tempDirs.push(dir);
  return dir;
}

describe("harness status (US-019)", () => {
  it("builds snapshot for empty project", () => {
    const root = tmp();
    const snap = buildStatus(root);
    expect(snap.stories.total).toBe(0);
    expect(snap.intakes.total).toBe(0);
    expect(snap.backlog.total).toBe(0);
    expect(snap.decisions.total).toBe(0);
    expect(snap.traces.total).toBe(0);
    expect(snap.index.present).toBe(false);
  });

  it("counts stories correctly", () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, "docs", "stories"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "docs", "stories", "US-001.md"),
      "---\nid: US-001\ntype: story\ntitle: One\nstatus: planned\n---\n\n# One\n",
    );
    fs.writeFileSync(
      path.join(root, "docs", "stories", "US-002.md"),
      "---\nid: US-002\ntype: story\ntitle: Two\nstatus: in_progress\n---\n\n# Two\n",
    );
    fs.writeFileSync(
      path.join(root, "docs", "stories", "US-003.md"),
      "---\nid: US-003\ntype: story\ntitle: Three\nstatus: implemented\n---\n\n# Three\n",
    );
    const snap = buildStatus(root);
    expect(snap.stories.total).toBe(3);
    expect(snap.stories.openCount).toBe(2); // planned + in_progress
    expect(snap.stories.inProgressCount).toBe(1);
  });

  it("formats human output", () => {
    const snap = buildStatus(tmp());
    const out = formatStatus(snap, false);
    expect(out).toContain("harness status v");
    expect(out).toContain("Stories");
    expect(out).toContain("Intakes");
    expect(out).toContain("Backlog");
  });

  it("formats JSON output", () => {
    const snap = buildStatus(tmp());
    const json = formatStatus(snap, true);
    const parsed = JSON.parse(json);
    expect(parsed.cliVersion).toBeDefined();
    expect(parsed.stories.total).toBe(0);
  });

  it("detects version mismatch", () => {
    const root = tmp();
    fs.writeFileSync(
      path.join(root, "AGENTS.md"),
      "<!-- harness-version: 0.1.0 -->\n",
    );
    const snap = buildStatus(root);
    expect(snap.version.mismatch).toBe(true);
    expect(snap.version.repo).toBe("0.1.0");
  });
});
