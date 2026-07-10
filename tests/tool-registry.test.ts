import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  registerTool,
  removeTool,
  checkAllTools,
  listAllTools,
} from "../src/application/tool-registry.js";
import { emptyToolRegistry, normalizeCapability } from "../src/domain/tool-registry.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-tr-"));
  tempDirs.push(dir);
  return dir;
}

describe("tool registry domain (US-022)", () => {
  it("normalizes capability names", () => {
    expect(normalizeCapability("Impact Analysis")).toBe("impact-analysis");
    expect(normalizeCapability("impact_analysis")).toBe("impact-analysis");
    expect(normalizeCapability("Deploy-Verification")).toBe("deploy-verification");
  });

  it("empty registry has no tools", () => {
    expect(emptyToolRegistry().tools).toEqual([]);
  });
});

describe("tool registry application (US-022)", () => {
  it("registers a cli tool with force", () => {
    const root = tmp();
    const tool = registerTool(root, {
      name: "my-lint",
      command: "eslint",
      description: "Lint JavaScript files for quality",
      responsibility: "Verification",
      force: true,
    });
    expect(tool.name).toBe("my-lint");
    expect(tool.kind).toBe("cli");
    expect(tool.status).toBe("unknown");
  });

  it("rejects duplicate tool names", () => {
    const root = tmp();
    registerTool(root, {
      name: "dup",
      command: "echo",
      description: "Duplicate tool test with 10 chars",
      responsibility: "Verification",
      force: true,
    });
    expect(() =>
      registerTool(root, {
        name: "dup",
        command: "echo2",
        description: "Another duplicate test with chars",
        responsibility: "Verification",
        force: true,
      }),
    ).toThrow(/already registered/);
  });

  it("removes a tool", () => {
    const root = tmp();
    registerTool(root, {
      name: "rm-me",
      command: "echo",
      description: "Tool to be removed with chars here",
      responsibility: "Verification",
      force: true,
    });
    const removed = removeTool(root, "rm-me");
    expect(removed).not.toBeNull();
    expect(removed!.name).toBe("rm-me");
    expect(listAllTools(root).length).toBe(0);
  });

  it("throws for missing tool on remove", () => {
    const root = tmp();
    expect(() => removeTool(root, "nope")).toThrow(/not registered/);
  });

  it("checks tools and persists status", () => {
    const root = tmp();
    registerTool(root, {
      name: "check-me",
      command: "node", // should be present
      description: "Tool to check with chars here too",
      responsibility: "Verification",
      force: false,
    });
    const results = checkAllTools(root);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]!.name).toBe("check-me");
    expect(results[0]!.status).toBe("present");
    expect(results[0]!.checked_at).toBeDefined();
  });
});
