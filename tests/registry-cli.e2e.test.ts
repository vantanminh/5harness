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
  opts: { cwd?: string; harnessHome: string },
) {
  return spawnSync(
    process.execPath,
    ["--import", "tsx", cliEntry, ...args],
    {
      cwd: opts.cwd ?? repoRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        HARNESS_HOME: opts.harnessHome,
      },
    },
  );
}

describe("registry CLI e2e", () => {
  it("link → projects → unlink", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-cli-home-"));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "harness-cli-proj-"));
    tempDirs.push(home, project);
    fs.writeFileSync(
      path.join(project, "package.json"),
      JSON.stringify({ name: "e2e-app" }),
      "utf8",
    );

    const link = runHarness(["link", project], { harnessHome: home });
    expect(link.status, link.stderr + link.stdout).toBe(0);
    expect(link.stdout).toMatch(/Linked project/i);
    expect(link.stdout).toContain("e2e-app");
    expect(fs.existsSync(path.join(home, "registry.json"))).toBe(true);

    const list = runHarness(["projects"], { harnessHome: home });
    expect(list.status, list.stderr + list.stdout).toBe(0);
    expect(list.stdout).toContain("e2e-app");
    expect(list.stdout).toMatch(/\bok\b/);

    const help = runHarness(["--help"], { harnessHome: home });
    expect(help.stdout).toContain("link");
    expect(help.stdout).toContain("unlink");
    expect(help.stdout).toContain("projects");

    const unlink = runHarness(["unlink", project], { harnessHome: home });
    expect(unlink.status, unlink.stderr + unlink.stdout).toBe(0);
    expect(unlink.stdout).toMatch(/Unlinked/i);

    const empty = runHarness(["projects"], { harnessHome: home });
    expect(empty.status).toBe(0);
    expect(empty.stdout).toMatch(/No linked projects/i);
  });

  it("query tools includes link/unlink/projects", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-cli-tools-"));
    tempDirs.push(home);
    const result = runHarness(["query", "tools", "--capability", "scaffold"], {
      harnessHome: home,
      cwd: repoRoot,
    });
    expect(result.status, result.stderr + result.stdout).toBe(0);
    expect(result.stdout).toMatch(/\blink\b/);
    expect(result.stdout).toMatch(/\bunlink\b/);
    expect(result.stdout).toMatch(/\bprojects\b/);
  });
});

