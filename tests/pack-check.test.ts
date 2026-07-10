import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("pack:check", () => {
  it("passes for the current package", () => {
    // On Windows, npm.cmd needs a shell. When shell:true, pass a single string
    // (no separate args array) to avoid DEP0190 deprecation warning.
    const result = spawnSync("npm run pack:check", [], {
      cwd: root,
      encoding: "utf8",
      shell: true,
    });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout + result.stderr).toMatch(/pack:check ok/);
  });
});
