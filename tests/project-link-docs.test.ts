import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("Project Link release documentation (US-063)", () => {
  const spec = read("docs/product/project-link.md");
  const cli = read("docs/product/cli-contract.md");
  const binding = read("docs/product/mcp-project-binding.md");
  const security = read("docs/SECURITY.md");
  const roadmap = read("docs/product/roadmap.md");
  const agentsTemplate = read("templates/AGENTS.md");
  const harnessTemplate = read("templates/docs/HARNESS.md");

  it("marks the initiative implemented and removes declaration-only wording", () => {
    expect(spec).toMatch(/Status:\*\* Implemented \(unreleased\)/i);
    expect(spec).not.toMatch(/planned\/declaration only/i);
    expect(roadmap).not.toMatch(/No implementation yet/i);
    expect(roadmap).toMatch(
      /\| I \| E16 \|[^\n]*Project Link[^\n]*implemented[^\n]*unreleased/i,
    );
  });

  it("documents every Project Link CLI namespace", () => {
    for (const command of [
      "harness project role",
      "harness project peer",
      "harness peer",
      "harness report",
    ]) {
      expect(cli).toContain(command);
    }
    expect(cli).toMatch(/doctor[\s\S]*peer index/i);
    expect(cli).toMatch(/status[\s\S]*open report/i);
    expect(cli).toMatch(/next[\s\S]*backend/i);
    expect(spec).toContain(
      "harness report update --id RP-### --status fixed --resolution",
    );
    expect(spec).toContain("harness report get RP-001 --from backend");
  });

  it("keeps default init templates free of Project Link behavior", () => {
    expect(agentsTemplate).not.toMatch(/HARNESS:PROJECT-LINK|report entities/i);
    expect(harnessTemplate).not.toMatch(/Project Link|docs\/reports/i);
  });

  it("separates OAuth calling-project binding from peer capabilities", () => {
    expect(binding).toMatch(/calling project/i);
    expect(binding).toMatch(/configured peer/i);
    expect(binding).toMatch(/OAuth grant\/header never selects the report target or peer/i);
    expect(binding).toMatch(/dynamic tool/i);
    expect(binding).not.toMatch(/tools only see that project's entities/i);
    expect(binding).toMatch(
      /single-project grant fixes the \*\*calling project\*\*/i,
    );
  });

  it("documents report-only target ownership and sanitization", () => {
    expect(security).toMatch(
      /reports are the only cross-project operational-entity write surface/i,
    );
    expect(security).toMatch(/target-owned/i);
    expect(security).toMatch(/peer-of-peer/i);
    expect(security).toMatch(
      /credentials[\s\S]{0,80}tokens[\s\S]{0,80}secrets/i,
    );
  });
});
