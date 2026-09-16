import { describe, expect, it } from "vitest";
import { generatePlanToken, handoffCommand, validatePlanInput, validatePlanToken } from "./plans";

describe("cloud implementation briefs", () => {
  it("creates a retrievable plan token and GitHub-style handoff command", () => {
    const token = generatePlanToken();
    expect(validatePlanToken(token)).toBe(true);
    expect(handoffCommand(token)).toBe("please implement plan from harness --" + token);
    const plan = validatePlanInput(
      {
        token: "kfkadjakdnjkad",
        project_id: "project-1234567890ab",
        title: "Export API",
        idea: "Add export",
        research_notes: "Checked similar CLIs",
        plan_markdown: "1. Route\n2. Tests",
        implement_prompt: "Implement the export API from this brief.",
        client_name: "chatgpt",
      },
      { uid: "user-1", email: "user@example.com" },
    );
    expect(plan?.token).toBe("kfkadjakdnjkad");
    expect(plan?.handoff_command).toBe("please implement plan from harness --kfkadjakdnjkad");
    expect(plan?.implement_prompt).toContain("Implement the export API");
    expect(plan?.created_by).toBe("user@example.com");
    expect(validatePlanInput({ title: "x" }, { uid: "user-1" })).toBeNull();
  });
});
