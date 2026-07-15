import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkPeerReportWritePolicy,
  PEER_WRITE_ROOTS_ENV,
  readPeerWritePolicy,
  requirePeerReportWriteAllowed,
} from "../src/application/peer-write-policy.js";
import { addReportToPeer } from "../src/application/report.js";
import { configureProjectPeer } from "../src/application/project-link.js";
import { linkProject } from "../src/application/registry.js";
import { setProjectRoleMarkers } from "../src/domain/project-link.js";
import { readEntityById } from "../src/infrastructure/entities.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function temp(prefix: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(root);
  return root;
}

function createProject(root: string, id: string, role: "frontend" | "backend"): void {
  fs.mkdirSync(root, { recursive: true });
  const agents = setProjectRoleMarkers(
    [
      "<!-- HARNESS:BEGIN -->",
      "<!-- harness-version: 0.21.0 -->",
      `<!-- harness-project-id: ${id} -->`,
      "## Harness",
      "<!-- HARNESS:END -->",
      "",
    ].join("\n"),
    role,
    [],
  );
  fs.writeFileSync(path.join(root, "AGENTS.md"), agents, "utf8");
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: path.basename(root) }),
    "utf8",
  );
}

describe("peer report write policy", () => {
  it("preserves configured-peer trust when unset and validates configured roots", () => {
    const parent = temp("harness-peer-policy-");
    const allowed = path.join(parent, "allowed");
    const target = path.join(allowed, "target");
    const outside = path.join(parent, "outside");
    fs.mkdirSync(target, { recursive: true });
    fs.mkdirSync(outside);

    expect(readPeerWritePolicy({})).toEqual({ configured: false, roots: [] });
    expect(checkPeerReportWritePolicy(outside, {}).allowed).toBe(true);

    const env = { [PEER_WRITE_ROOTS_ENV]: allowed };
    expect(readPeerWritePolicy(env)).toMatchObject({ configured: true });
    expect(requirePeerReportWriteAllowed(target, env)).toBe(
      fs.realpathSync.native(target),
    );
    expect(() => requirePeerReportWriteAllowed(outside, env)).toThrow(
      /outside HARNESS_PEER_WRITE_ROOTS/,
    );
    expect(() =>
      readPeerWritePolicy({ [PEER_WRITE_ROOTS_ENV]: "relative-root" }),
    ).toThrow(/absolute path/);
    expect(() =>
      readPeerWritePolicy({
        [PEER_WRITE_ROOTS_ENV]: `${allowed}${path.delimiter}`,
      }),
    ).toThrow(/empty path/);
  });

  it("enforces the policy before a configured peer report is created", () => {
    const home = temp("harness-peer-policy-home-");
    const parent = temp("harness-peer-policy-projects-");
    const frontend = path.join(parent, "frontend");
    const backend = path.join(parent, "backend");
    const frontendId = "11111111111111111111111111111111";
    const backendId = "22222222222222222222222222222222";
    createProject(frontend, frontendId, "frontend");
    createProject(backend, backendId, "backend");
    linkProject(frontend, { harnessHome: home });
    linkProject(backend, { harnessHome: home });
    configureProjectPeer(backendId, undefined, frontend, { harnessHome: home });

    expect(() =>
      addReportToPeer(
        frontend,
        { to: "backend", summary: "Must be denied" },
        {
          harnessHome: home,
          env: { [PEER_WRITE_ROOTS_ENV]: frontend },
        },
      ),
    ).toThrow(/outside HARNESS_PEER_WRITE_ROOTS/);
    expect(readEntityById(backend, "report", "RP-001")).toBeNull();

    addReportToPeer(
      frontend,
      { to: "backend", summary: "Allowed target" },
      {
        harnessHome: home,
        env: { [PEER_WRITE_ROOTS_ENV]: parent },
      },
    );
    expect(readEntityById(backend, "report", "RP-001")?.data.summary).toBe(
      "Allowed target",
    );
  });
});
