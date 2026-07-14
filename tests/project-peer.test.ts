import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  configureProjectPeer,
  listProjectPeers,
  removeProjectPeer,
  resolveProjectPeer,
} from "../src/application/project-link.js";
import { linkProject } from "../src/application/registry.js";
import {
  PROJECT_LINK_WORKFLOW_BEGIN,
  extractProjectPeers,
  setProjectRoleMarkers,
  upsertProjectPeerMarker,
  type ProjectRole,
} from "../src/domain/project-link.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function makeRoot(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(root);
  return root;
}

function createHarnessProject(
  projectRoot: string,
  id: string,
  role: ProjectRole | null,
): void {
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: path.basename(projectRoot) }),
    "utf8",
  );
  let agents = [
    "<!-- HARNESS:BEGIN -->",
    "<!-- harness-version: 0.20.0 -->",
    `<!-- harness-project-id: ${id} -->`,
    "## Harness",
    "<!-- HARNESS:END -->",
    "",
  ].join("\n");
  if (role) agents = setProjectRoleMarkers(agents, role, []);
  fs.writeFileSync(path.join(projectRoot, "AGENTS.md"), agents, "utf8");
}

describe("Project Link peer application", () => {
  const frontendId = "11111111111111111111111111111111";
  const backendId = "22222222222222222222222222222222";

  it("adds by registered path, infers roles, writes reverse, lists, and removes", () => {
    const home = makeRoot("harness-peer-home-");
    const parent = makeRoot("harness-peer-parent-");
    const frontend = path.join(parent, "frontend app");
    const backend = path.join(parent, "backend app");
    createHarnessProject(frontend, frontendId, "frontend");
    createHarnessProject(backend, backendId, "backend");
    linkProject(frontend, { harnessHome: home });
    linkProject(backend, { harnessHome: home });

    const added = configureProjectPeer(
      process.platform === "win32" ? ".\\backend app" : "./backend app",
      undefined,
      frontend,
      { harnessHome: home, cwd: parent },
    );
    expect(added.modified).toBe(true);
    expect(added.reverseModified).toBe(true);
    expect(added.warning).toBeNull();
    expect(added.peer).toMatchObject({
      id: backendId,
      role: "backend",
      resolved: true,
      path: path.resolve(backend),
    });

    const frontendPeers = extractProjectPeers(
      fs.readFileSync(path.join(frontend, "AGENTS.md"), "utf8"),
    );
    const backendPeers = extractProjectPeers(
      fs.readFileSync(path.join(backend, "AGENTS.md"), "utf8"),
    );
    expect(frontendPeers).toEqual([{ id: backendId, role: "backend" }]);
    expect(backendPeers).toEqual([{ id: frontendId, role: "frontend" }]);
    expect(listProjectPeers(frontend, { harnessHome: home })).toHaveLength(1);
    expect(
      resolveProjectPeer({ role: "backend" }, frontend, {
        harnessHome: home,
      }),
    ).toMatchObject({ id: backendId, role: "backend", path: path.resolve(backend) });
    expect(
      resolveProjectPeer({ peerId: backendId }, frontend, {
        harnessHome: home,
      }),
    ).toMatchObject({ id: backendId, role: "backend" });
    expect(() =>
      resolveProjectPeer({}, frontend, { harnessHome: home }),
    ).toThrow(/Select a configured peer/);
    expect(() =>
      resolveProjectPeer(
        { peerId: backendId, role: "backend" },
        frontend,
        { harnessHome: home },
      ),
    ).toThrow(/either/);

    const removed = removeProjectPeer(backendId, frontend, {
      harnessHome: home,
    });
    expect(removed.modified).toBe(true);
    expect(removed.reverseModified).toBe(true);
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

  it("fails closed for unregistered, mismatched, and self targets", () => {
    const home = makeRoot("harness-peer-fail-home-");
    const frontend = makeRoot("harness-peer-fail-fe-");
    const backend = makeRoot("harness-peer-fail-be-");
    createHarnessProject(frontend, frontendId, "frontend");
    createHarnessProject(backend, backendId, "backend");
    linkProject(frontend, { harnessHome: home });

    expect(() =>
      configureProjectPeer(backend, undefined, frontend, { harnessHome: home }),
    ).toThrow(/not linked/);
    expect(() =>
      configureProjectPeer(frontendId, undefined, frontend, {
        harnessHome: home,
      }),
    ).toThrow(/cannot be linked to itself/);

    linkProject(backend, { harnessHome: home });
    const registryPath = path.join(home, "registry.json");
    const registry = JSON.parse(fs.readFileSync(registryPath, "utf8")) as {
      projects: Array<{ id: string }>;
    };
    registry.projects.find((project) => project.id === backendId)!.id =
      "33333333333333333333333333333333";
    fs.writeFileSync(registryPath, JSON.stringify(registry), "utf8");
    expect(() =>
      configureProjectPeer(backend, undefined, frontend, { harnessHome: home }),
    ).toThrow(/does not match AGENTS\.md/);
  });

  it("keeps unresolved peers listable and locally removable", () => {
    const home = makeRoot("harness-peer-unresolved-home-");
    const frontend = makeRoot("harness-peer-unresolved-fe-");
    createHarnessProject(frontend, frontendId, "frontend");
    linkProject(frontend, { harnessHome: home });
    const agentsPath = path.join(frontend, "AGENTS.md");
    const withPeer = upsertProjectPeerMarker(
      fs.readFileSync(agentsPath, "utf8"),
      { id: backendId, role: "backend" },
    );
    fs.writeFileSync(agentsPath, withPeer, "utf8");

    expect(listProjectPeers(frontend, { harnessHome: home })).toEqual([
      {
        id: backendId,
        role: "backend",
        name: null,
        path: null,
        resolved: false,
        reason: "not linked on this machine",
      },
    ]);
    const removed = removeProjectPeer(backendId, frontend, {
      harnessHome: home,
    });
    expect(removed.modified).toBe(true);
    expect(removed.warning).toMatch(/reverse unlink failed/);
    expect(extractProjectPeers(fs.readFileSync(agentsPath, "utf8"))).toEqual([]);
  });

  it("uses other when a peer has no configured role", () => {
    const home = makeRoot("harness-peer-other-home-");
    const frontend = makeRoot("harness-peer-other-fe-");
    const shared = makeRoot("harness-peer-other-target-");
    createHarnessProject(frontend, frontendId, null);
    createHarnessProject(shared, backendId, null);
    linkProject(frontend, { harnessHome: home });
    linkProject(shared, { harnessHome: home });

    configureProjectPeer(backendId, undefined, frontend, { harnessHome: home });
    expect(
      extractProjectPeers(
        fs.readFileSync(path.join(frontend, "AGENTS.md"), "utf8"),
      ),
    ).toEqual([{ id: backendId, role: "other" }]);
    expect(
      extractProjectPeers(
        fs.readFileSync(path.join(shared, "AGENTS.md"), "utf8"),
      ),
    ).toEqual([{ id: frontendId, role: "other" }]);
    expect(
      fs.readFileSync(path.join(frontend, "AGENTS.md"), "utf8"),
    ).toContain(PROJECT_LINK_WORKFLOW_BEGIN);
    expect(
      fs.readFileSync(path.join(shared, "AGENTS.md"), "utf8"),
    ).toContain(PROJECT_LINK_WORKFLOW_BEGIN);

    const removed = removeProjectPeer(backendId, frontend, {
      harnessHome: home,
    });
    expect(removed.reverseModified).toBe(true);
    expect(
      fs.readFileSync(path.join(frontend, "AGENTS.md"), "utf8"),
    ).not.toContain(PROJECT_LINK_WORKFLOW_BEGIN);
    expect(
      fs.readFileSync(path.join(shared, "AGENTS.md"), "utf8"),
    ).not.toContain(PROJECT_LINK_WORKFLOW_BEGIN);
  });

  it("requires a unique role selector and rejects arbitrary linked projects", () => {
    const home = makeRoot("harness-peer-select-home-");
    const frontend = makeRoot("harness-peer-select-fe-");
    const backendA = makeRoot("harness-peer-select-a-");
    const backendB = makeRoot("harness-peer-select-b-");
    const backendAId = "44444444444444444444444444444444";
    const backendBId = "55555555555555555555555555555555";
    createHarnessProject(frontend, frontendId, "frontend");
    createHarnessProject(backendA, backendAId, "backend");
    createHarnessProject(backendB, backendBId, "backend");
    for (const project of [frontend, backendA, backendB]) {
      linkProject(project, { harnessHome: home });
    }

    configureProjectPeer(backendAId, undefined, frontend, {
      harnessHome: home,
    });
    expect(() =>
      resolveProjectPeer({ peerId: backendBId }, frontend, {
        harnessHome: home,
      }),
    ).toThrow(/not a configured peer/);

    configureProjectPeer(backendBId, undefined, frontend, {
      harnessHome: home,
    });
    expect(() =>
      resolveProjectPeer({ role: "backend" }, frontend, {
        harnessHome: home,
      }),
    ).toThrow(/ambiguous/);
  });
});
