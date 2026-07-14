import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractHarnessBlock, extractRepoVersion } from "../src/domain/upgrade.js";
import { VERSION } from "../src/version.js";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/**
 * US-032 / decision 0017: shipped AGENTS template must encode the agent
 * hard-fail contract (HARD STOP, no hand-edit fallback, recovery, exit codes).
 */
describe("AGENTS hard-fail contract (US-032 / 0017)", () => {
  const templatePath = path.join(packageRoot, "templates", "AGENTS.md");
  const template = fs.readFileSync(templatePath, "utf8");
  const block = extractHarnessBlock(template);

  it("has a versioned harness block matching CLI VERSION", () => {
    expect(block).not.toBeNull();
    expect(extractRepoVersion(template)).toBe(VERSION);
  });

  it("extracts a complete harness block (Upgrade prose must not embed raw END marker)", () => {
    // Regression: if Upgrade text contains the literal `<!-- HARNESS:END -->`
    // comment before the real terminator, extractHarnessBlock truncates early.
    expect(block).not.toBeNull();
    expect(block!.block.trimEnd().endsWith("<!-- HARNESS:END -->")).toBe(true);
    expect(block!.block).toMatch(/HARD STOP/i);
    expect(block!.block).toMatch(/harness doctor/);
    // Full terminator line must appear once as the block closer
    const endMatches = block!.block.match(/<!--\s*HARNESS:END\s*-->/g) ?? [];
    expect(endMatches.length).toBe(1);
  });

  it("requires HARD STOP on harness CLI/MCP failure", () => {
    expect(template).toMatch(/HARD STOP/i);
    expect(template).toMatch(/CLI|MCP/i);
  });

  it("forbids hand-edit fallback for durable entities", () => {
    expect(template).toMatch(/Never[\s\S]*hand-edit|hand-edit[\s\S]*Never/i);
    expect(template).toMatch(/story[\s\S]*decision[\s\S]*intake[\s\S]*backlog/i);
  });

  it("keeps Project Link workflow guidance conditional", () => {
    expect(template).not.toContain("HARNESS:PROJECT-LINK:BEGIN");
    expect(template).not.toContain("harness report add --to backend");
  });

  it("lists recovery steps: doctor, link, reindex", () => {
    expect(template).toMatch(/harness doctor/);
    expect(template).toMatch(/harness link/);
    expect(template).toMatch(/harness reindex/);
  });

  it("documents exit codes 0 / 1 / 2", () => {
    expect(template).toMatch(/Exit codes/i);
    expect(template).toMatch(/`0`/);
    expect(template).toMatch(/`1`/);
    expect(template).toMatch(/`2`/);
  });

  it("references decision 0017", () => {
    expect(template).toMatch(/0017/);
  });

  it("documents project id discovery and all-project MCP routing", () => {
    expect(template).toMatch(/harness project id/);
    expect(template).toMatch(/harness-project-id/);
    expect(template).toMatch(/X-Harness-Project/);
    expect(template).toMatch(/all-projects grant/i);
    expect(template).toMatch(/Never rely on cwd/i);
  });
});
