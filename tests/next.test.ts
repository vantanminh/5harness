import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildNextList, formatNextList } from "../src/application/next.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-nx-"));
  tempDirs.push(dir);
  return dir;
}

describe("harness next (US-020)", () => {
  it("returns empty for empty project", () => {
    const root = tmp();
    const items = buildNextList(root);
    expect(items).toEqual([]);
  });

  it("returns in_progress stories first", () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, "docs", "stories"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "docs", "stories", "US-A.md"),
      "---\nid: US-A\ntype: story\ntitle: Alpha\nstatus: planned\n---\n\n# A\n",
    );
    fs.writeFileSync(
      path.join(root, "docs", "stories", "US-B.md"),
      "---\nid: US-B\ntype: story\ntitle: Beta\nstatus: in_progress\n---\n\n# B\n",
    );
    const items = buildNextList(root);
    expect(items.length).toBeGreaterThanOrEqual(2);
    // US-B (in_progress) should come before US-A (planned)
    const idxB = items.findIndex((i) => i.id === "US-B");
    const idxA = items.findIndex((i) => i.id === "US-A");
    expect(idxB).toBeLessThan(idxA);
    expect(items[0]!.reason).toContain("in progress");
  });

  it("respects limit", () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, "docs", "stories"), { recursive: true });
    for (let i = 1; i <= 5; i++) {
      fs.writeFileSync(
        path.join(root, "docs", "stories", `US-${String(i).padStart(2, "0")}.md`),
        `---\nid: US-${String(i).padStart(2, "0")}\ntype: story\ntitle: S${i}\nstatus: planned\n---\n\n# S${i}\n`,
      );
    }
    const items = buildNextList(root, { limit: 3 });
    expect(items.length).toBe(3);
  });

  it("includes open backlog items", () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, "docs", "backlog"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "docs", "backlog", "BL-X.md"),
      "---\nid: BL-X\ntype: backlog\ntitle: Fix X\nstatus: proposed\n---\n\n# X\n",
    );
    const items = buildNextList(root);
    const bl = items.find((i) => i.id === "BL-X");
    expect(bl).toBeDefined();
    expect(bl!.type).toBe("backlog");
  });

  it("formats empty as human text", () => {
    const out = formatNextList([], false);
    expect(out).toContain("No pending");
  });

  it("formats as JSON", () => {
    const out = formatNextList([], true);
    const parsed = JSON.parse(out);
    expect(Array.isArray(parsed)).toBe(true);
  });
});
