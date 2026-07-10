import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  classifyFilePlan,
  hasBlockingConflicts,
} from "../src/domain/conflicts.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-conflict-"));
  tempDirs.push(dir);
  return dir;
}

describe("classifyFilePlan", () => {
  it("plans create when missing", () => {
    const dir = tempDir();
    expect(classifyFilePlan(dir, "AGENTS.md", false)).toEqual({
      kind: "create",
      relative: "AGENTS.md",
    });
  });

  it("blocks protected existing files without force", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "AGENTS.md"), "old", "utf8");
    const plan = classifyFilePlan(dir, "AGENTS.md", false);
    expect(plan.kind).toBe("skip");
    expect(hasBlockingConflicts([plan], false)).toEqual(["AGENTS.md"]);
  });

  it("overwrites when force is set", () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, "AGENTS.md"), "old", "utf8");
    expect(classifyFilePlan(dir, "AGENTS.md", true)).toEqual({
      kind: "overwrite",
      relative: "AGENTS.md",
    });
  });
});
