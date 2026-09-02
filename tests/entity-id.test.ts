import { describe, expect, it } from "vitest";
import { resolveEntityId } from "../src/commands/_entity-id.js";

describe("resolveEntityId", () => {
  it("uses the positional id", () => {
    expect(resolveEntityId("US-001", undefined, "story start")).toBe("US-001");
  });

  it("uses --id when positional is missing", () => {
    expect(resolveEntityId(undefined, "US-001", "story start")).toBe("US-001");
  });

  it("accepts matching positional and --id", () => {
    expect(resolveEntityId("US-001", "US-001", "story start")).toBe("US-001");
  });

  it("rejects disagreeing values", () => {
    expect(() => resolveEntityId("US-001", "US-002", "story start")).toThrow(
      /disagree/,
    );
  });

  it("rejects a missing id", () => {
    expect(() => resolveEntityId(undefined, undefined, "story start")).toThrow(
      /positional <id> or --id <id>/,
    );
  });
});
