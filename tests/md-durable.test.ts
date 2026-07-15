import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  addBacklogMd,
  addDecisionMd,
  addIntakeMd,
  addStoryMd,
  closeBacklogMd,
  updateIntakeMd,
  updateStoryMd,
} from "../src/application/md-durable.js";
import { parseFrontmatter } from "../src/domain/frontmatter.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-md-"));
  tempDirs.push(dir);
  return dir;
}

describe("markdown durable writes (no SQLite)", () => {
  it("writes story intake decision backlog entities", () => {
    const root = tempRoot();

    const intake = addIntakeMd(
      { projectRoot: root, db: null },
      {
        type: "spec_slice",
        summary: "md store",
        lane: "normal",
        story: "US-100",
        links: "stories/US-100",
      },
    );
    expect(intake.id).toBe("IN-001");
    expect(fs.existsSync(intake.file.absolutePath)).toBe(true);
    expect(intake.file.data.status).toBe("pending");

    const updatedIntake = updateIntakeMd(
      { projectRoot: root, db: null },
      {
        id: "IN-001",
        status: "completed",
        stories: "US-100,US-101",
        notes: "shipped",
      },
    );
    expect(updatedIntake.data.status).toBe("completed");
    expect(updatedIntake.data.stories).toEqual(["US-100", "US-101"]);
    expect(updatedIntake.data.links).toEqual([
      "stories/US-100",
      "US-100",
      "US-101",
    ]);
    expect(updatedIntake.data.notes).toBe("shipped");

    const story = addStoryMd(
      { projectRoot: root, db: null },
      {
        id: "US-100",
        title: "MD story",
        lane: "normal",
        links: "intakes/IN-001,decisions/D-1",
      },
    );
    expect(story.relativePath).toBe("docs/stories/US-100.md");

    updateStoryMd(
      { projectRoot: root, db: null },
      {
        id: "US-100",
        status: "implemented",
        unit: "1",
        integration: "1",
        e2e: "0",
        platform: "0",
      },
    );

    const storyRaw = fs.readFileSync(story.absolutePath, "utf8");
    const parsed = parseFrontmatter(storyRaw);
    expect(parsed.data.status).toBe("implemented");
    expect(parsed.data.unit).toBe(1);
    expect(parsed.data.links).toEqual(["intakes/IN-001", "decisions/D-1"]);

    addDecisionMd(
      { projectRoot: root, db: null },
      { id: "D-1", title: "Pick MD", links: "stories/US-100" },
    );
    expect(
      fs.existsSync(path.join(root, "docs/decisions/D-1.md")),
    ).toBe(true);

    const bl = addBacklogMd(
      { projectRoot: root, db: null },
      { title: "Index later", risk: "tiny" },
    );
    expect(bl.id).toBe("BL-001");
    closeBacklogMd(
      { projectRoot: root, db: null },
      { id: "BL-001", status: "implemented", outcome: "ok" },
    );
    const blRaw = fs.readFileSync(bl.file.absolutePath, "utf8");
    expect(parseFrontmatter(blRaw).data.status).toBe("implemented");
  });

  it("rejects duplicate story without db", () => {
    const root = tempRoot();
    addStoryMd(
      { projectRoot: root, db: null },
      { id: "US-1", title: "a", lane: "tiny" },
    );
    expect(() =>
      addStoryMd(
        { projectRoot: root, db: null },
        { id: "US-1", title: "b", lane: "tiny" },
      ),
    ).toThrow(/already exists/i);
  });

  it("rejects invalid lane", () => {
    const root = tempRoot();
    expect(() =>
      addStoryMd(
        { projectRoot: root, db: null },
        { id: "US-2", title: "x", lane: "nope" },
      ),
    ).toThrow(/Invalid risk lane/i);
  });

  it("validates intake lifecycle updates", () => {
    const root = tempRoot();
    addIntakeMd(
      { projectRoot: root, db: null },
      { type: "change_request", summary: "lifecycle", lane: "normal" },
    );
    expect(() =>
      updateIntakeMd(
        { projectRoot: root },
        { id: "IN-001", status: "closed" },
      ),
    ).toThrow(/Invalid intake status/i);
    expect(() =>
      updateIntakeMd({ projectRoot: root }, { id: "IN-001" }),
    ).toThrow(/requires status, stories, or notes/i);
  });

  it("auto-completes only after every linked story is implemented", () => {
    const root = tempRoot();
    for (const id of ["US-A", "US-B"]) {
      addStoryMd(
        { projectRoot: root },
        { id, title: id, lane: "normal" },
      );
    }
    const intake = addIntakeMd(
      { projectRoot: root },
      {
        type: "new_initiative",
        summary: "two stories",
        lane: "normal",
        stories: "US-A,US-B",
      },
    );

    updateStoryMd(
      { projectRoot: root },
      { id: "US-A", status: "implemented" },
    );
    expect(
      parseFrontmatter(fs.readFileSync(intake.file.absolutePath, "utf8")).data
        .status,
    ).toBe("pending");

    updateStoryMd(
      { projectRoot: root },
      { id: "US-B", status: "implemented" },
    );
    expect(
      parseFrontmatter(fs.readFileSync(intake.file.absolutePath, "utf8")).data
        .status,
    ).toBe("completed");
  });

  it("does not auto-complete missing-story or dismissed intakes", () => {
    const root = tempRoot();
    addStoryMd(
      { projectRoot: root },
      { id: "US-A", title: "A", lane: "normal" },
    );
    const missing = addIntakeMd(
      { projectRoot: root },
      {
        type: "change_request",
        summary: "missing story",
        lane: "normal",
        stories: "US-A,US-MISSING",
      },
    );
    const dismissed = addIntakeMd(
      { projectRoot: root },
      {
        type: "change_request",
        summary: "dismissed",
        lane: "normal",
        stories: "US-A",
      },
    );
    updateIntakeMd(
      { projectRoot: root },
      { id: dismissed.id, status: "dismissed" },
    );

    updateStoryMd(
      { projectRoot: root },
      { id: "US-A", status: "implemented" },
    );
    expect(
      parseFrontmatter(fs.readFileSync(missing.file.absolutePath, "utf8")).data
        .status,
    ).toBe("pending");
    expect(
      parseFrontmatter(fs.readFileSync(dismissed.file.absolutePath, "utf8"))
        .data.status,
    ).toBe("dismissed");
  });

  it("supports legacy singular story links but ignores unlinked intakes", () => {
    const root = tempRoot();
    addStoryMd(
      { projectRoot: root },
      { id: "US-LEGACY", title: "Legacy", lane: "normal" },
    );
    fs.mkdirSync(path.join(root, "docs", "intakes"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "docs", "intakes", "IN-LEGACY.md"),
      "---\nid: IN-LEGACY\ntype: intake\ninput_type: change_request\nsummary: legacy\nstory: US-LEGACY\n---\n\n# legacy\n",
    );
    const unlinked = addIntakeMd(
      { projectRoot: root },
      { type: "change_request", summary: "unlinked", lane: "normal" },
    );

    updateStoryMd(
      { projectRoot: root },
      { id: "US-LEGACY", status: "implemented" },
    );
    expect(
      parseFrontmatter(
        fs.readFileSync(
          path.join(root, "docs", "intakes", "IN-LEGACY.md"),
          "utf8",
        ),
      ).data.status,
    ).toBe("completed");
    expect(
      parseFrontmatter(fs.readFileSync(unlinked.file.absolutePath, "utf8")).data
        .status,
    ).toBe("pending");
  });
});
