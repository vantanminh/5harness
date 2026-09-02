import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("agent onboarding docs (IN-025)", () => {
  const agents = read("templates/AGENTS.md");
  const skill = read("templates/.agents/skills/harness/SKILL.md");

  it("explains what 5harness is before listing commands", () => {
    const heading = agents.indexOf("## Harness");
    const firstCommands = agents.indexOf("### First commands");
    expect(heading).toBeGreaterThan(-1);
    expect(firstCommands).toBeGreaterThan(heading);
    const intro = agents.slice(heading, firstCommands);
    expect(intro).toMatch(/coding\s+agents/i);
    expect(intro).toMatch(/Git-backed markdown/i);
    expect(intro).toMatch(/hand-edit/i);
  });

  it("starts agents on doctor/status/next instead of a policy dump", () => {
    expect(agents).toMatch(/harness doctor --json/);
    expect(agents).toMatch(/harness next --json/);
    expect(agents).toMatch(/Do \*\*not\*\* start by dumping/);
    expect(agents).not.toMatch(/### Before work — read/);
  });

  it("requires commit after each completed slice and forbids default push", () => {
    expect(agents).toMatch(/Commit after each completed slice/);
    expect(agents).toMatch(/Do \*\*not\*\* `git push` unless the user asked/);
    expect(skill).toMatch(/Commit after each completed slice/);
    expect(skill).toMatch(/Do not `git push` unless/);
  });

  it("shows --json on agent read examples", () => {
    expect(agents).toMatch(/harness search "…" --json/);
    expect(agents).toMatch(/harness get <id> --json/);
    expect(skill).toMatch(/harness get <id> --json/);
  });

  it("does not tell agents to create story files from templates", () => {
    expect(read("docs/FEATURE_INTAKE.md")).not.toMatch(
      /Create or update one story file from/,
    );
    expect(read("templates/docs/FEATURE_INTAKE.md")).not.toMatch(
      /Create a story from/,
    );
    expect(read("docs/CONTEXT_RULES.md")).not.toMatch(
      /Create or update a story\/progress file/,
    );
  });
});
