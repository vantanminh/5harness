import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildCatalog } from "../src/application/catalog.js";
import {
  queryBacklogMd,
  queryMatrixMd,
  queryStatsMd,
  queryStoriesMd,
} from "../src/application/md-query.js";
import {
  addBacklogMd,
  addStoryMd,
  closeBacklogMd,
  updateStoryMd,
} from "../src/application/md-durable.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-md-query-"));
  tempDirs.push(dir);
  return dir;
}

describe("markdown query (US-008)", () => {
  it("empty project returns empty tables without db", () => {
    const root = tmp();
    expect(queryMatrixMd(root)).toMatch(/id/);
    expect(queryStatsMd(root)).toMatch(/stories/);
    expect(queryStatsMd(root)).toMatch(/0/);
    const cat = buildCatalog(root);
    expect(cat.entries).toHaveLength(0);
  });

  it("matrix and stats reflect story frontmatter proof flags", () => {
    const root = tmp();
    addStoryMd(
      { projectRoot: root },
      { id: "US-Q", title: "Query story", lane: "normal" },
    );
    updateStoryMd(
      { projectRoot: root },
      {
        id: "US-Q",
        status: "implemented",
        unit: "1",
        integration: "0",
        e2e: "1",
        platform: "0",
        evidence: "tests green",
      },
    );

    const matrix = queryMatrixMd(root, true);
    expect(matrix).toMatch(/US-Q/);
    expect(matrix).toMatch(/implemented/);
    expect(matrix).toMatch(/tests green/);
    // unit=1 e2e=1 columns present as 1
    expect(matrix).toMatch(/1/);

    const stats = queryStatsMd(root);
    expect(stats).toMatch(/stories/);
    expect(stats).toContain("1");

    const stories = queryStoriesMd(root);
    expect(stories).toMatch(/US-Q/);
    expect(stories).toMatch(/Query story/);
  });

  it("backlog open/closed filters work from entity status", () => {
    const root = tmp();
    addBacklogMd(
      { projectRoot: root },
      { title: "Open item", risk: "tiny" },
    );
    const closed = addBacklogMd(
      { projectRoot: root },
      { title: "Done item", risk: "normal" },
    );
    closeBacklogMd(
      { projectRoot: root },
      { id: closed.id, status: "implemented", outcome: "shipped" },
    );

    const open = queryBacklogMd(root, "open");
    expect(open).toMatch(/Open item/);
    expect(open).not.toMatch(/Done item/);

    const closedView = queryBacklogMd(root, "closed");
    expect(closedView).toMatch(/Done item/);
    expect(closedView).not.toMatch(/Open item/);

    const all = queryBacklogMd(root, "all");
    expect(all).toMatch(/Open item/);
    expect(all).toMatch(/Done item/);
  });

  it("buildCatalog indexes multi-type entities by id", () => {
    const root = tmp();
    addStoryMd(
      { projectRoot: root },
      { id: "US-1", title: "One", lane: "tiny" },
    );
    addStoryMd(
      { projectRoot: root },
      { id: "US-2", title: "Two", lane: "normal" },
    );
    const cat = buildCatalog(root);
    expect(cat.byType.story).toHaveLength(2);
    expect(cat.byId.get("US-1")?.[0]?.title).toBe("One");
  });
});
