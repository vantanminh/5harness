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

function runHarness(
  args: string[],
  opts: { cwd?: string; harnessHome: string; input?: string },
) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", cliEntry, ...args],
    {
      cwd: opts.cwd ?? repoRoot,
      encoding: "utf8",
      input: opts.input,
      env: {
        ...process.env,
        HARNESS_HOME: opts.harnessHome,
      },
    },
  );
}

describe("remove CLI e2e", () => {
  it("remove --force deletes harness from a project", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-rm-e2e-home-"));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "harness-rm-e2e-proj-"));
    tempDirs.push(home, project);

    // Initialize harness in the project
    const init = runHarness(["init", project, "--yes"], { harnessHome: home });
    expect(init.status, init.stderr + init.stdout).toBe(0);

    // Verify harness is present
    expect(fs.existsSync(path.join(project, ".5harness"))).toBe(true);
    expect(fs.existsSync(path.join(project, "AGENTS.md"))).toBe(true);

    // Run remove --force (non-interactive)
    const remove = runHarness(
      ["remove", project, "--force"],
      { harnessHome: home },
    );
    expect(remove.status, remove.stderr + remove.stdout).toBe(0);
    expect(remove.stdout).toContain("Harness removed");

    // Verify harness state is gone
    expect(fs.existsSync(path.join(project, ".5harness"))).toBe(false);

    // Verify AGENTS.md no longer has harness block
    const agents = fs.readFileSync(path.join(project, "AGENTS.md"), "utf8");
    expect(agents).not.toContain("<!-- HARNESS:BEGIN -->");
    expect(agents).not.toContain("<!-- HARNESS:END -->");
    expect(agents).not.toContain("harness-version");
  });

  it("rm alias works same as remove", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-rm-alias-home-"));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "harness-rm-alias-proj-"));
    tempDirs.push(home, project);

    runHarness(["init", project, "--yes"], { harnessHome: home });

    const rmResult = runHarness(
      ["rm", project, "--force"],
      { harnessHome: home },
    );
    expect(rmResult.status, rmResult.stderr + rmResult.stdout).toBe(0);
    expect(rmResult.stdout).toContain("Harness removed");
    expect(fs.existsSync(path.join(project, ".5harness"))).toBe(false);
  });

  it("remove without --force prompts and cancels on 'n'", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-rm-prompt-home-"));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "harness-rm-prompt-proj-"));
    tempDirs.push(home, project);

    runHarness(["init", project, "--yes"], { harnessHome: home });

    const result = runHarness(
      ["remove", project],
      { harnessHome: home, input: "n\n" },
    );
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain("Remove cancelled");
    // Harness should still be present
    expect(fs.existsSync(path.join(project, ".5harness"))).toBe(true);
  });

  it("remove with --keep-entities preserves docs/stories", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-rm-keep-home-"));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "harness-rm-keep-proj-"));
    tempDirs.push(home, project);

    runHarness(["init", project, "--yes"], { harnessHome: home });

    // Add a story entity
    const storiesDir = path.join(project, "docs", "stories");
    expect(fs.existsSync(storiesDir)).toBe(true);
    fs.writeFileSync(
      path.join(storiesDir, "US-001.md"),
      "# US-001 Test Story\n",
      "utf8",
    );

    const result = runHarness(
      ["remove", project, "--force", "--keep-entities"],
      { harnessHome: home },
    );
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toContain("Harness removed");

    // State dir should be removed
    expect(fs.existsSync(path.join(project, ".5harness"))).toBe(false);
    // Stories should be preserved
    expect(fs.existsSync(storiesDir)).toBe(true);
    expect(fs.readFileSync(path.join(storiesDir, "US-001.md"), "utf8")).toContain("US-001");
  });

  it("remove is listed in --help", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-rm-help-home-"));
    tempDirs.push(home);

    const help = runHarness(["--help"], { harnessHome: home });
    expect(help.stdout).toContain("remove");
    expect(help.stdout).toContain("rm");
  });

  it("query tools includes remove and rm", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-rm-tools-home-"));
    tempDirs.push(home);

    const result = runHarness(["query", "tools", "--capability", "scaffold"], {
      harnessHome: home,
      cwd: repoRoot,
    });
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toMatch(/\bremove\b/);
    expect(result.stdout).toMatch(/\brm\b/);
  });
});