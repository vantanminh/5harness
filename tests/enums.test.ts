import { describe, expect, it } from "vitest";
import {
  parseInputType,
  parseIntakeStatus,
  parseProofFlag,
  parseRiskLane,
  proofDisplay,
} from "../src/domain/enums.js";

describe("parseRiskLane", () => {
  it("accepts high-risk and high_risk", () => {
    expect(parseRiskLane("high-risk")).toBe("high_risk");
    expect(parseRiskLane("high_risk")).toBe("high_risk");
    expect(parseRiskLane("tiny")).toBe("tiny");
  });

  it("rejects unknown lanes", () => {
    expect(() => parseRiskLane("low")).toThrow(/Invalid risk lane/);
  });
});

describe("parseInputType", () => {
  it("normalizes dashed forms", () => {
    expect(parseInputType("spec-slice")).toBe("spec_slice");
    expect(parseInputType("maintenance request")).toBe("maintenance");
  });
});

describe("parseIntakeStatus", () => {
  it("accepts lifecycle values and rejects aliases", () => {
    expect(parseIntakeStatus("pending")).toBe("pending");
    expect(parseIntakeStatus("completed")).toBe("completed");
    expect(parseIntakeStatus("dismissed")).toBe("dismissed");
    expect(() => parseIntakeStatus("closed")).toThrow(/Invalid intake status/);
  });
});

describe("parseProofFlag", () => {
  it("only allows 0 or 1", () => {
    expect(parseProofFlag("1", "unit")).toBe(1);
    expect(parseProofFlag("0", "unit")).toBe(0);
    expect(() => parseProofFlag("yes", "unit")).toThrow(/0 or 1/);
  });
});

describe("proofDisplay", () => {
  it("formats yes/no or numeric", () => {
    expect(proofDisplay(1, false)).toBe("yes");
    expect(proofDisplay(0, true)).toBe("0");
  });
});
