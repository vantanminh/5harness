import { describe, expect, it } from "vitest";
import { scoreTrace } from "../src/domain/trace-score.js";

describe("scoreTrace", () => {
  it("scores incomplete without outcome/changed", () => {
    const result = scoreTrace({
      id: 1,
      task_summary: "work",
    });
    expect(result.achieved).toBe("incomplete");
    expect(result.missingMinimal.length).toBeGreaterThan(0);
  });

  it("scores minimal when only base fields set", () => {
    const result = scoreTrace({
      id: 1,
      task_summary: "work",
      outcome: "completed",
      files_changed: "src/a.ts",
      risk_lane: "tiny",
    });
    expect(result.achieved).toBe("minimal");
    expect(result.meetsRequirement).toBe(true);
  });

  it("scores standard when agent/actions/read/friction present", () => {
    const result = scoreTrace({
      id: 2,
      task_summary: "work",
      outcome: "completed",
      files_changed: "src/a.ts",
      agent: "grok",
      actions_taken: "edit",
      files_read: "README.md",
      harness_friction: "none",
      risk_lane: "normal",
    });
    expect(result.achieved).toBe("standard");
    expect(result.meetsRequirement).toBe(true);
  });
});
