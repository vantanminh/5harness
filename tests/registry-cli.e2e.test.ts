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
    expect(list.stdout).toMatch(/[a-f0-9]{16}/);
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

  it("query tools includes link/unlink/projects/project id", () => {
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
    expect(result.stdout).toMatch(/project id/);
  });

  it("project id ensures, prints JSON, and syncs the registry", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-cli-id-home-"));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "harness-cli-id-proj-"));
    tempDirs.push(home, project);
    fs.writeFileSync(
      path.join(project, "AGENTS.md"),
      "<!-- HARNESS:BEGIN -->\n<!-- harness-version: 0.16.0 -->\n<!-- HARNESS:END -->\n",
      "utf8",
    );

    const missing = runHarness(["project", "id", "--dir", project], {
      harnessHome: home,
    });
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toMatch(/--ensure/);

    const ensured = runHarness(
      ["project", "id", "--dir", project, "--ensure", "--json"],
      { harnessHome: home },
    );
    expect(ensured.status, ensured.stderr + ensured.stdout).toBe(0);
    const identity = JSON.parse(ensured.stdout) as {
      id: string;
      path: string;
      name: string;
    };
    expect(identity.id).toMatch(/^[a-f0-9]{32}$/);
    expect(identity.path).toBe(path.resolve(project));

    const plain = runHarness(["project", "id", "--dir", project], {
      harnessHome: home,
    });
    expect(plain.status, plain.stderr + plain.stdout).toBe(0);
    expect(plain.stdout.trim()).toBe(identity.id);

    const registry = JSON.parse(
      fs.readFileSync(path.join(home, "registry.json"), "utf8"),
    ) as { projects: Array<{ id: string }> };
    expect(registry.projects[0]?.id).toBe(identity.id);
  });
});
