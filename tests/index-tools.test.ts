import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildProjectIndex,
  formatSearchHits,
  linksFor,
  searchIndex,
  writeProjectIndex,
} from "../src/application/index-store.js";
import { addDecisionMd, addStoryMd } from "../src/application/md-durable.js";
import { writeEntityFile } from "../src/infrastructure/entities.js";
import { extractWikilinks } from "../src/domain/wikilinks.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-idx-"));
  tempDirs.push(dir);
  return dir;
}

describe("agent index (US-009)", () => {
  it("parses wikilinks", () => {
    expect(extractWikilinks("See [[US-001]] and [[stories/US-002|two]]")).toEqual([
      "US-001",
      "stories/US-002",
    ]);
  });

  it("reindex writes .5harness/index and search returns snippets", () => {
    const root = tmp();
    addStoryMd(
      { projectRoot: root },
      {
        id: "US-IDX",
        title: "Indexable story about widgets",
        lane: "normal",
        links: "decisions/D-1",
      },
    );
    addDecisionMd(
      { projectRoot: root },
      { id: "D-1", title: "Widget decision", status: "accepted" },
    );
    // body wikilink + broken link
    writeEntityFile(
      root,
      "docs/stories/US-IDX.md",
      {
        id: "US-IDX",
        type: "story",
        title: "Indexable story about widgets",
        status: "planned",
        lane: "normal",
        links: ["decisions/D-1"],
      },
      "# Indexable\n\nRelated [[D-1]] and missing [[NOPE]].\n",
    );

    const written = writeProjectIndex(root);
    expect(fs.existsSync(written.path)).toBe(true);
    expect(written.entities).toBeGreaterThanOrEqual(2);

    const index = buildProjectIndex(root);
    const hits = searchIndex(index, "widgets");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.path).toMatch(/US-IDX/);
    expect(hits[0]!.snippet.length).toBeGreaterThan(0);
    expect(hits[0]!.snippet.length).toBeLessThan(400);
    // token discipline: one hit row, not dumping all entity texts blobs
    const formatted = formatSearchHits(hits);
    expect(formatted.split("\n\n").length).toBeLessThanOrEqual(hits.length);
    expect(formatted.length).toBeLessThan(1500);

    const links = linksFor(index, "US-IDX");
    expect(links.outbound.some((o) => o.to === "D-1")).toBe(true);
    expect(links.broken).toContain("NOPE");

    const back = linksFor(index, "D-1");
    expect(back.backlinks.some((b) => b.from === "US-IDX")).toBe(true);
  });

  it("empty search query yields no hits", () => {
    const root = tmp();
    const index = buildProjectIndex(root);
    expect(searchIndex(index, "   ")).toEqual([]);
  });
});
