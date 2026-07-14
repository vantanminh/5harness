import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { extractProjectId } from "../src/domain/project-id.js";

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

function idOf(projectRoot: string): string {
  const id = extractProjectId(
    fs.readFileSync(path.join(projectRoot, "AGENTS.md"), "utf8"),
  );
  if (!id) throw new Error("missing test project id");
  return id;
}

describe("Project Link peer read CLI e2e", () => {
  it("searches, gets, contexts, and links only the selected peer root", () => {
    const home = temp("harness-peer-read-home-");
    const frontend = temp("harness-peer-read-fe-");
    const backend = temp("harness-peer-read-be-");
    for (const project of [frontend, backend]) {
      const init = runHarness(["init", project, "--yes"], repoRoot, home);
      expect(init.status, init.stderr + init.stdout).toBe(0);
    }
    expect(
      runHarness(
        ["project", "role", "set", "frontend", "--dir", frontend],
        repoRoot,
        home,
      ).status,
    ).toBe(0);
    expect(
      runHarness(
        ["project", "role", "set", "backend", "--dir", backend],
        repoRoot,
        home,
      ).status,
    ).toBe(0);
    expect(
      runHarness(
        ["project", "peer", "add", backend, "--dir", frontend],
        repoRoot,
        home,
      ).status,
    ).toBe(0);

    const localStory = runHarness(
      [
        "story",
        "add",
        "--id",
        "US-SHARED",
        "--title",
        "Frontend local contract",
        "--lane",
        "normal",
        "--notes",
        "frontend-only-token",
        "--dir",
        frontend,
      ],
      repoRoot,
      home,
    );
    expect(localStory.status, localStory.stderr + localStory.stdout).toBe(0);
    const peerDecision = runHarness(
      [
        "decision",
        "add",
        "--id",
        "D-PEER",
        "--title",
        "Backend contract decision",
        "--dir",
        backend,
      ],
      repoRoot,
      home,
    );
    expect(peerDecision.status, peerDecision.stderr + peerDecision.stdout).toBe(0);
    const peerStory = runHarness(
      [
        "story",
        "add",
        "--id",
        "US-SHARED",
        "--title",
        "Backend canonical contract",
        "--lane",
        "normal",
        "--notes",
        "backend-unique-token",
        "--links",
        "D-PEER",
        "--dir",
        backend,
      ],
      repoRoot,
      home,
    );
    expect(peerStory.status, peerStory.stderr + peerStory.stdout).toBe(0);

    const search = runHarness(
      [
        "peer",
        "search",
        "backend-unique-token",
        "--role",
        "backend",
        "--dir",
        frontend,
      ],
      repoRoot,
      home,
    );
    expect(search.status, search.stderr + search.stdout).toBe(0);
    expect(search.stdout).toContain("US-SHARED");
    expect(search.stdout).toContain("backend-unique-token");
    expect(search.stdout).not.toContain("frontend-only-token");
    expect(search.stdout.length).toBeLessThan(1500);

    const backendId = idOf(backend);
    const get = runHarness(
      [
        "peer",
        "get",
        "US-SHARED",
        "--peer",
        backendId,
        "--summary",
        "--dir",
        frontend,
      ],
      repoRoot,
      home,
    );
    expect(get.status, get.stderr + get.stdout).toBe(0);
    expect(get.stdout).toContain("Backend canonical contract");
    expect(get.stdout).not.toContain("Frontend local contract");

    const context = runHarness(
      [
        "peer",
        "context",
        "US-SHARED",
        "--role",
        "backend",
        "--max-chars",
        "200",
        "--json",
        "--dir",
        frontend,
      ],
      repoRoot,
      home,
    );
    expect(context.status, context.stderr + context.stdout).toBe(0);
    const contextJson = JSON.parse(context.stdout) as {
      id: string;
      maxChars: number;
      frontmatter: { title: string };
    };
    expect(contextJson.id).toBe("US-SHARED");
    expect(contextJson.maxChars).toBe(200);
    expect(contextJson.frontmatter.title).toBe("Backend canonical contract");

    const links = runHarness(
      [
        "peer",
        "links",
        "US-SHARED",
        "--role",
        "backend",
        "--dir",
        frontend,
      ],
      repoRoot,
      home,
    );
    expect(links.status, links.stderr + links.stdout).toBe(0);
    expect(links.stdout).toContain("D-PEER");
  });

  it("fails for missing selectors, arbitrary linked ids, and ambiguous roles", () => {
    const home = temp("harness-peer-select-cli-home-");
    const frontend = temp("harness-peer-select-cli-fe-");
    const backendA = temp("harness-peer-select-cli-a-");
    const backendB = temp("harness-peer-select-cli-b-");
    for (const project of [frontend, backendA, backendB]) {
      const init = runHarness(["init", project, "--yes"], repoRoot, home);
      expect(init.status, init.stderr + init.stdout).toBe(0);
    }
    for (const backend of [backendA, backendB]) {
      expect(
        runHarness(
          ["project", "role", "set", "backend", "--dir", backend],
          repoRoot,
          home,
        ).status,
      ).toBe(0);
    }

    const noSelector = runHarness(
      ["peer", "search", "anything", "--dir", frontend],
      repoRoot,
      home,
    );
    expect(noSelector.status).toBe(1);
    expect(noSelector.stderr).toContain("Select a configured peer");

    const arbitrary = runHarness(
      [
        "peer",
        "get",
        "US-NOPE",
        "--peer",
        idOf(backendB),
        "--dir",
        frontend,
      ],
      repoRoot,
      home,
    );
    expect(arbitrary.status).toBe(1);
    expect(arbitrary.stderr).toContain("not a configured peer");

    for (const backend of [backendA, backendB]) {
      expect(
        runHarness(
          ["project", "peer", "add", backend, "--dir", frontend],
          repoRoot,
          home,
        ).status,
      ).toBe(0);
    }
    const ambiguous = runHarness(
      [
        "peer",
        "search",
        "anything",
        "--role",
        "backend",
        "--dir",
        frontend,
      ],
      repoRoot,
      home,
    );
    expect(ambiguous.status).toBe(1);
    expect(ambiguous.stderr).toContain("ambiguous");
  });
});
