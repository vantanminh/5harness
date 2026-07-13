import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultProjectName,
  emptyRegistry,
  findProjectByPath,
  normalizeProjectPath,
  parseRegistryJson,
  projectIdFromPath,
  removeProjectByPath,
  upsertProject,
} from "../src/domain/registry.js";
import { resolveHarnessHome, registryFilePath } from "../src/domain/paths.js";
import {
  linkProject,
  listLinkedProjects,
  unlinkProject,
} from "../src/application/registry.js";
import { extractProjectId } from "../src/domain/project-id.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveHarnessHome", () => {
  it("defaults to ~/.5harness", () => {
    const home = path.join(os.tmpdir(), "fake-home-reg");
    expect(resolveHarnessHome({}, () => home)).toBe(path.join(home, ".5harness"));
  });

  it("honors HARNESS_HOME", () => {
    const custom = path.join(os.tmpdir(), "custom-harness-home");
    expect(resolveHarnessHome({ HARNESS_HOME: custom }, () => "/x")).toBe(
      path.resolve(custom),
    );
  });
});

describe("domain registry helpers", () => {
  it("stable project id from path", () => {
    const p = path.resolve("/tmp/my-app");
    expect(projectIdFromPath(p)).toBe(projectIdFromPath(p));
    expect(projectIdFromPath(p)).toHaveLength(16);
  });

  it("upsert is idempotent and updates name", () => {
    let reg = emptyRegistry();
    const p = normalizeProjectPath(path.join(os.tmpdir(), "proj-a"));
    const r1 = upsertProject(reg, { path: p, name: "a", remote: null }, "t1");
    expect(r1.created).toBe(true);
    reg = r1.registry;
    const r2 = upsertProject(reg, { path: p, name: "b", remote: null }, "t2");
    expect(r2.created).toBe(false);
    expect(r2.registry.projects).toHaveLength(1);
    expect(r2.entry.name).toBe("b");
    expect(r2.entry.linked_at).toBe("t1");
    expect(r2.entry.updated_at).toBe("t2");
  });

  it("replaces a legacy path id with an explicit canonical id", () => {
    const p = normalizeProjectPath(path.join(os.tmpdir(), "proj-canonical"));
    const first = upsertProject(emptyRegistry(), {
      path: p,
      name: "canonical",
      remote: null,
    });
    const canonicalId = "0123456789abcdef0123456789abcdef";
    const second = upsertProject(first.registry, {
      id: canonicalId,
      path: p,
      name: "canonical",
      remote: null,
    });
    expect(second.created).toBe(false);
    expect(second.entry.id).toBe(canonicalId);
    expect(second.registry.projects).toHaveLength(1);
  });

  it("relocates a canonical id linked from another path", () => {
    const id = "0123456789abcdef0123456789abcdef";
    const secondPath = path.join(os.tmpdir(), "proj-two");
    const first = upsertProject(emptyRegistry(), {
      id,
      path: path.join(os.tmpdir(), "proj-one"),
      name: "one",
      remote: null,
    });
    const relocated = upsertProject(first.registry, {
      id,
      path: secondPath,
      name: "two",
      remote: null,
    });
    expect(relocated.created).toBe(false);
    expect(relocated.entry.path).toBe(normalizeProjectPath(secondPath));
    expect(relocated.registry.projects).toHaveLength(1);
  });

  it("remove by path", () => {
    let reg = emptyRegistry();
    const p = normalizeProjectPath(path.join(os.tmpdir(), "proj-b"));
    reg = upsertProject(reg, { path: p, name: "b", remote: null }).registry;
    const { registry, removed } = removeProjectByPath(reg, p);
    expect(removed?.name).toBe("b");
    expect(registry.projects).toHaveLength(0);
    expect(findProjectByPath(registry, p)).toBeUndefined();
  });

  it("parseRegistryJson validates version", () => {
    const json = JSON.stringify({
      version: 1,
      projects: [{ path: path.resolve("/tmp/x"), name: "x" }],
    });
    const reg = parseRegistryJson(json);
    expect(reg.projects).toHaveLength(1);
    expect(reg.projects[0]!.id).toBeTruthy();
  });

  it("defaultProjectName uses basename", () => {
    expect(defaultProjectName(path.join("/tmp", "my-repo"))).toBe("my-repo");
  });
});

describe("link/unlink application", () => {
  it("links, lists, unlinks under temp HARNESS_HOME", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-home-"));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "harness-proj-"));
    tempDirs.push(home, project);
    fs.writeFileSync(
      path.join(project, "package.json"),
      JSON.stringify({ name: "demo-app" }),
      "utf8",
    );

    const linked = linkProject(project, { harnessHome: home });
    expect(linked.created).toBe(true);
    expect(linked.entry.name).toBe("demo-app");
    expect(fs.existsSync(registryFilePath(home))).toBe(true);

    const again = linkProject(project, { harnessHome: home });
    expect(again.created).toBe(false);
    expect(listLinkedProjects({ harnessHome: home })).toHaveLength(1);
    expect(listLinkedProjects({ harnessHome: home })[0]!.missing).toBe(false);

    const un = unlinkProject(project, { harnessHome: home });
    expect(un.removed?.path).toBe(normalizeProjectPath(project));
    expect(listLinkedProjects({ harnessHome: home })).toHaveLength(0);
  });

  it("marks missing paths", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-home-m-"));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "harness-proj-m-"));
    tempDirs.push(home, project);

    linkProject(project, { harnessHome: home });
    fs.rmSync(project, { recursive: true, force: true });
    const listed = listLinkedProjects({ harnessHome: home });
    expect(listed).toHaveLength(1);
    expect(listed[0]!.missing).toBe(true);
  });

  it("link ensures a marker and uses it as the registry id", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-home-id-"));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "harness-proj-id-"));
    tempDirs.push(home, project);
    fs.writeFileSync(
      path.join(project, "AGENTS.md"),
      "<!-- HARNESS:BEGIN -->\n<!-- harness-version: 0.16.0 -->\n<!-- HARNESS:END -->\n",
      "utf8",
    );

    const linked = linkProject(project, { harnessHome: home });
    const agents = fs.readFileSync(path.join(project, "AGENTS.md"), "utf8");
    expect(linked.entry.id).toBe(extractProjectId(agents));
  });

  it("rejects non-existent path on link", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-home-e-"));
    tempDirs.push(home);
    expect(() =>
      linkProject(path.join(home, "nope"), { harnessHome: home }),
    ).toThrow(/does not exist/i);
  });
});
