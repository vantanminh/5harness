import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  extractProjectId,
  generateProjectId,
  insertProjectIdMarker,
} from "../src/domain/project-id.js";
import {
  ensureProjectId,
  readProjectId,
} from "../src/infrastructure/project-id.js";
import { applyHarnessBlockUpgrade } from "../src/infrastructure/upgrade.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function harnessAgents(): string {
  return [
    "# Local rules",
    "",
    "<!-- HARNESS:BEGIN -->",
    "<!-- harness-version: 0.16.0 -->",
    "## Harness",
    "<!-- HARNESS:END -->",
    "",
    "Local tail.",
    "",
  ].join("\n");
}

describe("project id domain", () => {
  it("generates random lowercase hex ids", () => {
    const first = generateProjectId();
    const second = generateProjectId();
    expect(first).toMatch(/^[a-f0-9]{32}$/);
    expect(second).toMatch(/^[a-f0-9]{32}$/);
    expect(first).not.toBe(second);
  });

  it("inserts and extracts the marker inside the managed block", () => {
    const id = "0123456789abcdef0123456789abcdef";
    const updated = insertProjectIdMarker(harnessAgents(), id);
    expect(extractProjectId(updated)).toBe(id);
    expect(updated).toContain(
      `<!-- harness-version: 0.16.0 -->\n<!-- harness-project-id: ${id} -->`,
    );
    expect(updated).toContain("Local tail.");
    expect(insertProjectIdMarker(updated, generateProjectId())).toBe(updated);
  });
});

describe("project id persistence", () => {
  it("ensures once and remains stable", () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "harness-id-"));
    tempDirs.push(project);
    fs.writeFileSync(path.join(project, "AGENTS.md"), harnessAgents(), "utf8");

    const created = ensureProjectId(project);
    const again = ensureProjectId(project);
    const read = readProjectId(project);

    expect(created.created).toBe(true);
    expect(again.created).toBe(false);
    expect(again.id).toBe(created.id);
    expect(read.id).toBe(created.id);
  });

  it("fails read with an actionable error when the marker is absent", () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "harness-id-"));
    tempDirs.push(project);
    fs.writeFileSync(path.join(project, "AGENTS.md"), harnessAgents(), "utf8");
    expect(() => readProjectId(project)).toThrow(/--ensure/);
  });

  it("preserves the id while replacing the managed block on upgrade", () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "harness-id-"));
    tempDirs.push(project);
    const id = "0123456789abcdef0123456789abcdef";
    const current = insertProjectIdMarker(harnessAgents(), id);
    fs.writeFileSync(path.join(project, "AGENTS.md"), current, "utf8");
    const template = harnessAgents().replace("0.16.0", "0.17.0");

    const result = applyHarnessBlockUpgrade(project, template);
    const upgraded = fs.readFileSync(path.join(project, "AGENTS.md"), "utf8");

    expect(result.modified).toBe(true);
    expect(extractProjectId(upgraded)).toBe(id);
    expect(upgraded).toContain("harness-version: 0.17.0");
    expect(upgraded).toContain("Local tail.");
  });
});
