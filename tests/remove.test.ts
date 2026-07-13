import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { removeHarnessBlock } from "../src/domain/upgrade.js";
import { removeHarness } from "../src/application/remove.js";
import { HARNESS_BEGIN, HARNESS_END } from "../src/domain/upgrade.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("removeHarnessBlock (domain)", () => {
  it("strips the harness block from AGENTS.md content, keeping user text", () => {
    const content = [
      "# My Project",
      "",
      "Some user instructions here.",
      "",
      HARNESS_BEGIN,
      "<!-- harness-version: 0.17.0 -->",
      "<!-- harness-project-id: abc123def456 -->",
      "## Harness",
      "",
      "This repo uses **Harness**.",
      HARNESS_END,
      "",
      "## Custom Section",
      "",
      "More user content.",
    ].join("\n");

    const result = removeHarnessBlock(content);
    expect(result).not.toContain(HARNESS_BEGIN);
    expect(result).not.toContain(HARNESS_END);
    expect(result).not.toContain("harness-version");
    expect(result).not.toContain("harness-project-id");
    expect(result).toContain("# My Project");
    expect(result).toContain("Some user instructions here.");
    expect(result).toContain("## Custom Section");
    expect(result).toContain("More user content.");
  });

  it("returns original text when no harness block is present", () => {
    const content = "# Just a normal file\n\nNothing to see here.\n";
    expect(removeHarnessBlock(content)).toBe(content);
  });

  it("collapses excessive blank lines left by block removal", () => {
    const content = [
      "before",
      "",
      "",
      HARNESS_BEGIN,
      "block content",
      HARNESS_END,
      "",
      "",
      "",
      "after",
    ].join("\n");

    const result = removeHarnessBlock(content);
    // Should not have 3+ consecutive newlines
    expect(result).not.toMatch(/\n{3,}/);
    expect(result).toContain("before");
    expect(result).toContain("after");
  });
});

describe("removeHarness (application)", () => {
  it("removes harness state, registry entry, and strips AGENTS.md", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "harness-remove-home-"));
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "harness-remove-proj-"));
    tempDirs.push(home, project);

    // Set up a harnessed project
    const stateDir = path.join(project, ".5harness");
    const backupDir = path.join(project, ".5harness-backup");
    const agentsPath = path.join(project, "AGENTS.md");
    const dbPath = path.join(project, "harness.db");

    fs.mkdirSync(path.join(stateDir, "index"), { recursive: true });
    fs.mkdirSync(path.join(backupDir, "2026-01-01"), { recursive: true });
    fs.writeFileSync(path.join(stateDir, "index", "index.json"), "{}", "utf8");
    fs.writeFileSync(dbPath, "sqlite-placeholder", "utf8");

    fs.writeFileSync(
      agentsPath,
      [
        "# My Project",
        "",
        "User instructions.",
        "",
        HARNESS_BEGIN,
        "<!-- harness-version: 0.17.0 -->",
        "<!-- harness-project-id: abc123def4567890 -->",
        "## Harness",
        "",
        "Managed block content.",
        HARNESS_END,
        "",
        "## User Section",
      ].join("\n"),
      "utf8",
    );

    // Register in registry
    const registryHome = path.join(home, ".5harness");
    fs.mkdirSync(registryHome, { recursive: true });
    fs.writeFileSync(
      path.join(registryHome, "registry.json"),
      JSON.stringify({
        version: 1,
        projects: [
          {
            id: "abc123def4567890",
            path: project,
            name: "test-project",
            linked_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            remote: null,
          },
        ],
      }),
      "utf8",
    );

    const result = removeHarness({
      dir: project,
      harnessHome: registryHome,
    });

    expect(result.unlinked).toBe(true);
    expect(result.removed).toContain("global registry entry");
    expect(result.removed).toContain(".5harness");
    expect(result.removed).toContain(".5harness-backup");
    expect(result.removed).toContain("harness.db");
    expect(result.removed).toContain("AGENTS.md (harness block stripped)");

    // Verify state dir is gone
    expect(fs.existsSync(stateDir)).toBe(false);
    // Verify backup dir is gone
    expect(fs.existsSync(backupDir)).toBe(false);
    // Verify db is gone
    expect(fs.existsSync(dbPath)).toBe(false);
    // Verify AGENTS.md has no harness block
    const cleaned = fs.readFileSync(agentsPath, "utf8");
    expect(cleaned).not.toContain(HARNESS_BEGIN);
    expect(cleaned).not.toContain(HARNESS_END);
    expect(cleaned).toContain("# My Project");
    expect(cleaned).toContain("## User Section");
  });

  it("keepEntities option preserves entity directories", () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "harness-remove-keep-"));
    tempDirs.push(project);

    // Set up entity dirs with content
    const storiesDir = path.join(project, "docs", "stories");
    fs.mkdirSync(storiesDir, { recursive: true });
    fs.writeFileSync(path.join(storiesDir, "US-001.md"), "story", "utf8");

    const stateDir = path.join(project, ".5harness");
    fs.mkdirSync(path.join(stateDir, "index"), { recursive: true });

    const result = removeHarness({
      dir: project,
      keepEntities: true,
    });

    expect(result.removed).toContain(".5harness");
    expect(result.removed).not.toContain("docs/stories");
    // Entity dir should still exist
    expect(fs.existsSync(storiesDir)).toBe(true);
  });
});