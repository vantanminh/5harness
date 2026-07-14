import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { extractProjectId } from "../src/domain/project-id.js";
import { extractProjectPeers } from "../src/domain/project-link.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliEntry = path.join(repoRoot, "src", "cli.ts");
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function temp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

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

function projectId(projectRoot: string): string {
  const id = extractProjectId(
    fs.readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8"),
  );
  if (!id) throw new Error("missing test project id");
  return id;
}

describe("Project Link peer CLI e2e", () => {
  it("links two initialized projects, resolves JSON, reverses, and unlinks", () => {
    const home = temp("harness-peer-cli-home-");
    const parent = temp("harness-peer-cli-parent-");
    const frontend = path.join(parent, "frontend app");
    const backend = path.join(parent, "backend app");

    for (const project of [frontend, backend]) {
      const init = runHarness(["init", project, "--yes"], repoRoot, home);
      expect(init.status, init.stderr + init.stdout).toBe(0);
    }
    const feRole = runHarness(
      ["project", "role", "set", "frontend", "--dir", frontend],
      repoRoot,
      home,
    );
    const beRole = runHarness(
      ["project", "role", "set", "backend", "--dir", backend],
      repoRoot,
      home,
    );
    expect(feRole.status, feRole.stderr + feRole.stdout).toBe(0);
    expect(beRole.status, beRole.stderr + beRole.stdout).toBe(0);

    const add = runHarness(
      ["project", "peer", "add", backend, "--dir", frontend],
      repoRoot,
      home,
    );
    expect(add.status, add.stderr + add.stdout).toBe(0);
    expect(add.stdout).toContain("Added project peer");
    expect(add.stdout).toContain("role: backend");

    const frontendId = projectId(frontend);
    const backendId = projectId(backend);
    expect(
      extractProjectPeers(
        fs.readFileSync(path.join(frontend, "AGENTS.md"), "utf8"),
      ),
    ).toEqual([{ id: backendId, role: "backend" }]);
    expect(
      extractProjectPeers(
        fs.readFileSync(path.join(backend, "AGENTS.md"), "utf8"),
      ),
    ).toEqual([{ id: frontendId, role: "frontend" }]);

    const list = runHarness(
      ["project", "peer", "list", "--dir", frontend, "--json"],
      repoRoot,
      home,
    );
    expect(list.status, list.stderr + list.stdout).toBe(0);
    expect(JSON.parse(list.stdout)).toEqual([
      {
        id: backendId,
        role: "backend",
        name: path.basename(backend),
        path: path.resolve(backend),
        resolved: true,
        reason: null,
      },
    ]);

    const remove = runHarness(
      ["project", "peer", "remove", backendId, "--dir", frontend],
      repoRoot,
      home,
    );
    expect(remove.status, remove.stderr + remove.stdout).toBe(0);
    expect(remove.stdout).toContain(`Removed project peer: ${backendId}`);
    expect(
      extractProjectPeers(
        fs.readFileSync(path.join(frontend, "AGENTS.md"), "utf8"),
      ),
    ).toEqual([]);
    expect(
      extractProjectPeers(
        fs.readFileSync(path.join(backend, "AGENTS.md"), "utf8"),
      ),
    ).toEqual([]);
  });

  it("fails closed for an unregistered target and doctor warns unresolved", () => {
    const home = temp("harness-peer-cli-fail-home-");
    const frontend = temp("harness-peer-cli-fail-fe-");
    const backend = temp("harness-peer-cli-fail-be-");
    const initFe = runHarness(["init", frontend, "--yes"], repoRoot, home);
    const initBe = runHarness(["init", backend, "--yes"], repoRoot, home);
    expect(initFe.status, initFe.stderr + initFe.stdout).toBe(0);
    expect(initBe.status, initBe.stderr + initBe.stdout).toBe(0);
    const backendId = projectId(backend);

    const unlink = runHarness(["unlink", backend], repoRoot, home);
    expect(unlink.status, unlink.stderr + unlink.stdout).toBe(0);
    const fail = runHarness(
      ["project", "peer", "add", backend, "--dir", frontend],
      repoRoot,
      home,
    );
    expect(fail.status).toBe(1);
    expect(fail.stderr).toContain("not linked on this machine");

    const agentsPath = path.join(frontend, "AGENTS.md");
    const agents = fs
      .readFileSync(agentsPath, "utf8")
      .replace(
        "## Harness",
        `<!-- harness-peer: id=${backendId};role=backend -->\n## Harness`,
      );
    fs.writeFileSync(agentsPath, agents, "utf8");

    const doctor = runHarness(
      ["doctor", "--dir", frontend, "--json"],
      repoRoot,
      home,
    );
    expect(doctor.status, doctor.stderr + doctor.stdout).toBe(0);
    const report = JSON.parse(doctor.stdout) as {
      checks: Array<{ name: string; status: string; message: string }>;
    };
    expect(report.checks.find((check) => check.name === "project-peers")).toMatchObject({
      status: "warn",
    });
  });

  it("advertises the peer commands and tool entry", () => {
    const home = temp("harness-peer-cli-help-");
    const help = runHarness(["project", "peer", "--help"], repoRoot, home);
    expect(help.status, help.stderr + help.stdout).toBe(0);
    expect(help.stdout).toContain("add");
    expect(help.stdout).toContain("remove");
    expect(help.stdout).toContain("list");

    const tools = runHarness(
      ["query", "tools", "--capability", "scaffold"],
      repoRoot,
      home,
    );
    expect(tools.status, tools.stderr + tools.stdout).toBe(0);
    expect(tools.stdout).toContain("project peer");
  });
});
