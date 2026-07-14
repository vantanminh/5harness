import { describe, expect, it } from "vitest";
import { WATCH_DIRS } from "../src/commands/watch.js";

describe("watch entity directories", () => {
  it("uses canonical singular backlog and report paths", () => {
    expect(WATCH_DIRS).toContain("docs/backlog");
    expect(WATCH_DIRS).toContain("docs/reports");
    expect(WATCH_DIRS).not.toContain("docs/backlogs");
  });
});
