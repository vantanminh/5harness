import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDoctor, formatDoctorReport } from "../src/application/doctor.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-dr-"));
  tempDirs.push(dir);
  return dir;
}

describe("harness doctor (US-018)", () => {
  it("reports missing markdown store as fail", () => {
    const root = tmp();
    const report = runDoctor(root);
    const storeCheck = report.checks.find((c) => c.name === "markdown-store");
    expect(storeCheck).toBeDefined();
    expect(storeCheck!.status).toBe("fail");
    expect(report.healthy).toBe(false);
  });

  it("reports fresh index when present", () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, "docs", "stories"), { recursive: true });
    fs.mkdirSync(path.join(root, ".harness", "index"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".harness", "index", "index.json"),
      JSON.stringify({
        version: 1,
        built_at: new Date().toISOString(),
        projectRoot: root,
        catalog: [],
        edges: [],
        texts: {},
      }),
    );
    const report = runDoctor(root);
    const idxCheck = report.checks.find((c) => c.name === "index-fresh");
    expect(idxCheck).toBeDefined();
    expect(idxCheck!.status).toBe("ok");
  });

  it("detects stale index", () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, "docs", "stories"), { recursive: true });
    fs.mkdirSync(path.join(root, ".harness", "index"), { recursive: true });
    // index built 1 hour ago
    const past = new Date(Date.now() - 3600_000).toISOString();
    fs.writeFileSync(
      path.join(root, ".harness", "index", "index.json"),
      JSON.stringify({
        version: 1,
        built_at: past,
        projectRoot: root,
        catalog: [],
        edges: [],
        texts: {},
      }),
    );
    // entity newer than index
    fs.writeFileSync(
      path.join(root, "docs", "stories", "US-FRESH.md"),
      `---\nid: US-FRESH\ntype: story\ntitle: Test\nstatus: planned\n---\n\n# Test\n`,
    );
    const report = runDoctor(root);
    const idxCheck = report.checks.find((c) => c.name === "index-fresh");
    expect(idxCheck).toBeDefined();
    expect(idxCheck!.status).toBe("warn");
  });

  it("formats human output", () => {
    const report = runDoctor(tmp());
    const out = formatDoctorReport(report, false);
    expect(out).toContain("harness doctor v");
    expect(out).toContain("markdown-store");
  });

  it("formats JSON output", () => {
    const report = runDoctor(tmp());
    const json = formatDoctorReport(report, true);
    const parsed = JSON.parse(json);
    expect(parsed.cliVersion).toBeDefined();
    expect(Array.isArray(parsed.checks)).toBe(true);
    expect(typeof parsed.healthy).toBe("boolean");
  });

  it("reports log file path (US-033)", () => {
    const report = runDoctor(tmp());
    const logs = report.checks.find((c) => c.name === "logs");
    expect(logs).toBeDefined();
    expect(logs!.status).toBe("ok");
    expect(logs!.message).toMatch(/log file|Log file/i);
  });

  it("reports index-integrity check (US-034)", () => {
    const report = runDoctor(tmp());
    const integ = report.checks.find((c) => c.name === "index-integrity");
    expect(integ).toBeDefined();
    expect(["ok", "warn", "fail"]).toContain(integ!.status);
  });
});
