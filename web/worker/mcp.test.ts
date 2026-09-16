import { describe, expect, it } from "vitest";
import { MCP_SEQUENTIAL_GUIDE } from "./catalog";
import { validateOAuthGrantProps } from "./mcp";

const env = {
  FIREBASE_PROJECT_ID: "harness5",
  FIREBASE_API_KEY: "api-key",
};

const grant = {
  uid: "firebase-user-1",
  projectId: "harness5",
  firebaseApiKey: "api-key",
  firebaseRefreshToken: "refresh-token",
};

describe("hosted MCP plan handoff", () => {
  it("exposes sequential-read guidance and a tokenized coding-agent command", () => {
    expect(MCP_SEQUENTIAL_GUIDE).toContain("harness_plan_create");
    expect(MCP_SEQUENTIAL_GUIDE).toContain("please implement plan from harness --");
    expect(MCP_SEQUENTIAL_GUIDE).toContain("harness plan get");
  });
});

describe("MCP OAuth grant binding", () => {
  it("accepts a grant issued for this Firebase identity and Worker", () => {
    expect(validateOAuthGrantProps(grant, "firebase-user-1", env)).toEqual(grant);
  });

  it.each([
    ["user", "firebase-user-2", grant],
    ["project", "firebase-user-1", { ...grant, projectId: "another-project" }],
    ["API key", "firebase-user-1", { ...grant, firebaseApiKey: "another-key" }],
  ])("rejects a grant with a mismatched %s", (_field, tokenUserId, value) => {
    expect(() => validateOAuthGrantProps(value, tokenUserId, env)).toThrow(
      "Harness OAuth grant is not valid for this Worker.",
    );
  });
});
