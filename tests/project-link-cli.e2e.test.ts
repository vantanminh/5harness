import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliEntry = path.join(repoRoot, "src", "cli.ts");
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function runHarness(args: string[], cwd: string, harnessHome: string) {
  return spawnSync(process.execPath, ["--import", "tsx", cliEntry, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      HARNESS_HOME: harnessHome,
      HARNESS_NO_UPDATE_CHECK: "1",
    },
  });
}

describe("Project Link role CLI e2e", () => {
  it("keeps init opt-in, then sets, shows, changes, and validates metadata", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-role-home-"));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "harness-role-project-"));
    tempDirs.push(home, project);

    const init = runHarness(["init", project, "--yes"], repoRoot, home);
    expect(init.status, init.stderr + init.stdout).toBe(0);
    const initializedAgents = fs.readFileSync(path.join(project, "AGENTS.md"), "utf8");
    expect(initializedAgents).not.toContain("harness-project-role");
    expect(initializedAgents).not.toContain("harness-project-stack");

    const empty = runHarness(
      ["project", "role", "show", "--dir", project, "--json"],
      repoRoot,
      home,
    );
    expect(empty.status, empty.stderr + empty.stdout).toBe(0);
    expect(JSON.parse(empty.stdout)).toEqual({ role: null, stack: [] });

    const set = runHarness(
      [
        "project",
        "role",
        "set",
        "frontend",
        "--stack",
        "supabase,custom_api",
        "--dir",
        project,
      ],
      repoRoot,
      home,
    );
    expect(set.status, set.stderr + set.stdout).toBe(0);
    expect(set.stdout).toContain("Set project role: frontend");
    expect(set.stdout).toContain("Stack: supabase, custom_api");

    const show = runHarness(
      ["project", "role", "show", "--dir", project, "--json"],
      repoRoot,
      home,
    );
    expect(show.status, show.stderr + show.stdout).toBe(0);
    expect(JSON.parse(show.stdout)).toEqual({
      role: "frontend",
      stack: ["supabase", "custom_api"],
    });

    const change = runHarness(
      ["project", "role", "set", "backend", "--dir", project],
      repoRoot,
      home,
    );
    expect(change.status, change.stderr + change.stdout).toBe(0);
    const changedAgents = fs.readFileSync(path.join(project, "AGENTS.md"), "utf8");
    expect(changedAgents).toContain("harness-project-role: backend");
    expect(changedAgents).not.toContain("harness-project-stack");

    const invalid = runHarness(
      ["project", "role", "set", "database", "--dir", project],
      repoRoot,
      home,
    );
    expect(invalid.status).toBe(1);
    expect(invalid.stderr).toContain("Invalid project role");
  });

  it("advertises the role commands and tool entry", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-role-help-"));
    tempDirs.push(home);
    const help = runHarness(["project", "role", "--help"], repoRoot, home);
    expect(help.status, help.stderr + help.stdout).toBe(0);
    expect(help.stdout).toContain("set");
    expect(help.stdout).toContain("show");

    const tools = runHarness(
      ["query", "tools", "--capability", "scaffold"],
      repoRoot,
      home,
    );
    expect(tools.status, tools.stderr + tools.stdout).toBe(0);
    expect(tools.stdout).toContain("project role");
  });
});
