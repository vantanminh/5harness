import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  extractProjectRoleConfig,
  extractProjectPeers,
  parseProjectRole,
  parseProjectStack,
  preserveProjectLinkMarkers,
  removeProjectPeerMarker,
  setProjectRoleMarkers,
  upsertProjectPeerMarker,
} from "../src/domain/project-link.js";
import { applyHarnessBlockUpgrade } from "../src/infrastructure/upgrade.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function agents(version = "0.20.0"): string {
  return [
    "# Local rules",
    "",
    "<!-- HARNESS:BEGIN -->",
    `<!-- harness-version: ${version} -->`,
    "<!-- harness-project-id: 0123456789abcdef0123456789abcdef -->",
    "## Harness",
    "Managed text.",
    "<!-- HARNESS:END -->",
    "",
    "Local tail.",
    "",
  ].join("\n");
}

describe("Project Link role metadata", () => {
  it("validates the locked roles and bounded stack tags", () => {
    expect(parseProjectRole(" Frontend ")).toBe("frontend");
    expect(() => parseProjectRole("database")).toThrow(/frontend.*backend/);
    expect(parseProjectStack("supabase,custom_api")).toEqual([
      "supabase",
      "custom_api",
    ]);
    expect(parseProjectStack(undefined)).toEqual([]);
    expect(() => parseProjectStack("Supabase")).toThrow(/lowercase/);
    expect(() => parseProjectStack("a,b,c,d,e")).toThrow(/at most 4/);
    expect(() => parseProjectStack("a".repeat(33))).toThrow(/at most 32/);
    expect(() => parseProjectStack("api,api")).toThrow(/duplicate/);
  });

  it("writes and reads role/stack only inside the managed block", () => {
    const withOutsideDecoy = `${agents()}<!-- harness-project-role: backend -->\n`;
    const updated = setProjectRoleMarkers(
      withOutsideDecoy,
      "frontend",
      ["supabase", "custom_api"],
    );

    expect(extractProjectRoleConfig(updated)).toEqual({
      role: "frontend",
      stack: ["supabase", "custom_api"],
    });
    expect(updated).toContain(
      "<!-- harness-project-id: 0123456789abcdef0123456789abcdef -->\n" +
        "<!-- harness-project-role: frontend -->\n" +
        "<!-- harness-project-stack: supabase,custom_api -->",
    );
    expect(updated).toContain("Local tail.");
    expect(updated.trimEnd()).toMatch(/harness-project-role: backend -->$/);
  });

  it("replaces existing metadata and clears stack when omitted", () => {
    const configured = setProjectRoleMarkers(agents(), "frontend", ["firebase"]);
    const changed = setProjectRoleMarkers(configured, "backend", []);

    expect(extractProjectRoleConfig(changed)).toEqual({
      role: "backend",
      stack: [],
    });
    expect(changed).not.toContain("harness-project-stack");
    expect(changed.match(/harness-project-role/g)).toHaveLength(1);
    expect(setProjectRoleMarkers(changed, "backend", [])).toBe(changed);
  });

  it("preserves role, stack, and future peer markers across template replacement", () => {
    const configured = setProjectRoleMarkers(agents("0.19.0"), "frontend", [
      "supabase",
    ]).replace(
      "<!-- harness-project-stack: supabase -->",
      "<!-- harness-project-stack: supabase -->\n" +
        "<!-- harness-peer: id=abcdef0123456789;role=backend -->",
    );
    const nextBlock = agents("0.21.0");

    const preserved = preserveProjectLinkMarkers(nextBlock, configured);
    expect(preserved).toContain("harness-project-role: frontend");
    expect(preserved).toContain("harness-project-stack: supabase");
    expect(preserved).toContain(
      "harness-peer: id=abcdef0123456789;role=backend",
    );

    const project = fs.mkdtempSync(path.join(os.tmpdir(), "harness-role-upgrade-"));
    tempDirs.push(project);
    fs.writeFileSync(path.join(project, "AGENTS.md"), configured, "utf8");
    applyHarnessBlockUpgrade(project, agents("0.21.0"));
    const upgraded = fs.readFileSync(path.join(project, "AGENTS.md"), "utf8");
    expect(extractProjectRoleConfig(upgraded)).toEqual({
      role: "frontend",
      stack: ["supabase"],
    });
    expect(upgraded).toContain("harness-peer: id=abcdef0123456789;role=backend");
    expect(upgraded).toContain("Local tail.");
  });
});

describe("Project Link peer metadata", () => {
  const backendId = "abcdef0123456789abcdef0123456789";
  const mobileId = "9876543210abcdef9876543210abcdef";

  it("upserts, parses, and removes peers by durable project id", () => {
    const configured = setProjectRoleMarkers(agents(), "frontend", ["web"]);
    const withBackend = upsertProjectPeerMarker(configured, {
      id: backendId,
      role: "backend",
    });
    const withBoth = upsertProjectPeerMarker(withBackend, {
      id: mobileId,
      role: "mobile",
    });
    const updated = upsertProjectPeerMarker(withBoth, {
      id: backendId,
      role: "service",
    });

    expect(extractProjectPeers(updated)).toEqual([
      { id: mobileId, role: "mobile" },
      { id: backendId, role: "service" },
    ]);
    expect(updated.match(/harness-peer/g)).toHaveLength(2);
    expect(updated.indexOf("harness-project-stack")).toBeLessThan(
      updated.indexOf("harness-peer"),
    );

    const removed = removeProjectPeerMarker(updated, mobileId);
    expect(extractProjectPeers(removed)).toEqual([
      { id: backendId, role: "service" },
    ]);
    expect(removeProjectPeerMarker(removed, mobileId)).toBe(removed);
  });

  it("rejects malformed and duplicate peer markers", () => {
    const duplicate = agents().replace(
      "## Harness",
      `<!-- harness-peer: id=${backendId};role=backend -->\n` +
        `<!-- harness-peer: id=${backendId};role=service -->\n` +
        "## Harness",
    );
    expect(() => extractProjectPeers(duplicate)).toThrow(/Duplicate/);

    const missingRole = agents().replace(
      "## Harness",
      `<!-- harness-peer: id=${backendId} -->\n## Harness`,
    );
    expect(() => extractProjectPeers(missingRole)).toThrow(/id and role/);
  });

  it("preserves CRLF while writing peer markers", () => {
    const crlf = agents().replaceAll("\n", "\r\n");
    const updated = upsertProjectPeerMarker(crlf, {
      id: backendId,
      role: "backend",
    });
    expect(updated).toContain(
      `<!-- harness-peer: id=${backendId};role=backend -->\r\n`,
    );
    expect(updated.replaceAll("\r\n", "")).not.toContain("\n");
  });
});
