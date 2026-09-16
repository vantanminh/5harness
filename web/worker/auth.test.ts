import { describe, expect, it } from "vitest";
import { AuthError, getBearerToken } from "./auth";

describe("Bearer token parsing", () => {
  it("accepts the colon-delimited opaque tokens issued to the CLI", () => {
    const token = "u".repeat(28) + ":" + "g".repeat(16) + ":" + "s".repeat(32);
    const request = new Request("https://worker.example/api/sync/projects", {
      headers: { Authorization: "Bearer " + token },
    });

    expect(getBearerToken(request)).toBe(token);
  });

  it("rejects bearer values containing whitespace", () => {
    const request = new Request("https://worker.example/api/sync/projects", {
      headers: { Authorization: "Bearer " + "x".repeat(20) + " invalid" },
    });

    expect(() => getBearerToken(request)).toThrow(AuthError);
  });
});
