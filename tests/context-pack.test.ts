import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildContextPack, formatContextPack } from "../src/application/context-pack.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-cx-"));
  tempDirs.push(dir);
  return dir;
}

function seedStory(root: string, id: string, title: string, status: string, body: string, links?: string[]) {
  fs.mkdirSync(path.join(root, "docs", "stories"), { recursive: true });
  const linkLines = links ? links.map((l) => `  - ${l}`).join("\n") : "";
  fs.writeFileSync(
    path.join(root, "docs", "stories", `${id}.md`),
    `---\nid: ${id}\ntype: story\ntitle: ${title}\nstatus: ${status}\nunit: 0\nintegration: 0\ne2e: 1\nplatform: 0\nlane: normal\n${linkLines ? `links:\n${linkLines}\n` : ""}---\n\n# ${title}\n\n${body}\n`,
  );
}

describe("harness context (US-021)", () => {
  it("returns null for missing entity", () => {
    const root = tmp();
    expect(buildContextPack(root, "US-NOPE")).toBeNull();
  });

  it("builds context pack for a story", () => {
    const root = tmp();
    seedStory(root, "US-CX", "Context Test", "planned", "Test body content.");
    const pack = buildContextPack(root, "US-CX");
    expect(pack).not.toBeNull();
    expect(pack!.id).toBe("US-CX");
    expect(pack!.type).toBe("story");
    expect(pack!.body).toContain("Test body content");
    expect(pack!.proof).toBeDefined();
    expect((pack!.proof as Record<string, unknown>).e2e).toBe(1);
  });

  it("respects maxChars budget", () => {
    const root = tmp();
    seedStory(root, "US-BUDGET", "Budget", "planned", "A".repeat(5000));
    const pack = buildContextPack(root, "US-BUDGET", {
      depth: 0,
      maxChars: 100,
    });
    expect(pack).not.toBeNull();
    expect(pack!.body).toContain("(truncated)");
    expect(pack!.body.length).toBeLessThan(200);
  });

  it("includes outbound links and backlinks", () => {
    const root = tmp();
    seedStory(root, "US-LINK", "Link Story", "planned", "See [[US-TARGET]]", ["US-TARGET"]);
    seedStory(root, "US-TARGET", "Target", "implemented", "I am the target.");
    const pack = buildContextPack(root, "US-LINK");
    expect(pack).not.toBeNull();
    expect(pack!.outbound.length).toBeGreaterThan(0);
    expect(pack!.outbound.some((o) => o.to === "US-TARGET")).toBe(true);
  });

  it("formats human output", () => {
    const root = tmp();
    seedStory(root, "US-FMT", "Format", "planned", "Format body.");
    const pack = buildContextPack(root, "US-FMT");
    const out = formatContextPack(pack!, false);
    expect(out).toContain("US-FMT");
    expect(out).toContain("Body");
    expect(out).toContain("Proof");
  });

  it("formats JSON output", () => {
    const root = tmp();
    seedStory(root, "US-JSON", "JSON", "planned", "JSON body.");
    const pack = buildContextPack(root, "US-JSON");
    const json = formatContextPack(pack!, true);
    const parsed = JSON.parse(json);
    expect(parsed.id).toBe("US-JSON");
  });
});
