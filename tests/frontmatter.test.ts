import { describe, expect, it } from "vitest";
import {
  parseFrontmatter,
  serializeEntityFile,
} from "../src/domain/frontmatter.js";
import {
  entityRelativePath,
  sanitizeEntityId,
} from "../src/domain/entities.js";

describe("frontmatter", () => {
  it("round-trips scalars and links arrays", () => {
    const raw = serializeEntityFile(
      {
        id: "US-001",
        type: "story",
        unit: 1,
        title: "Hello: world",
        links: ["decisions/0011", "intakes/IN-001"],
        notes: null,
      },
      "# Body\n\ntext\n",
    );
    expect(raw.startsWith("---\n")).toBe(true);
    const { data, body } = parseFrontmatter(raw);
    expect(data.id).toBe("US-001");
    expect(data.type).toBe("story");
    expect(data.unit).toBe(1);
    expect(data.links).toEqual(["decisions/0011", "intakes/IN-001"]);
    expect(data.notes).toBeNull();
    expect(body).toContain("# Body");
  });

  it("round-trips multiline report context as a quoted scalar", () => {
    const context = "line one\r\n---\r\nkey: \"value\"\r\nC:\\work\\repo";
    const raw = serializeEntityFile({ context });
    expect(raw).toContain("context: \"");
    expect(parseFrontmatter(raw).data.context).toBe(context);
  });

  it("preserves numeric-looking identifiers as strings", () => {
    const projectId = "22222222222222222222222222222222";
    const raw = serializeEntityFile({ project_id: projectId });
    expect(raw).toContain(`project_id: "${projectId}"`);
    expect(parseFrontmatter(raw).data.project_id).toBe(projectId);
  });

  it("rejects invalid entity ids", () => {
    expect(() => sanitizeEntityId("../x")).toThrow();
    expect(() => sanitizeEntityId("a/b")).toThrow();
    expect(sanitizeEntityId("US-001")).toBe("US-001");
  });

  it("builds relative paths", () => {
    expect(entityRelativePath("story", "US-007")).toBe(
      "docs/stories/US-007.md",
    );
    expect(entityRelativePath("decision", "d1", "docs/decisions/custom.md")).toBe(
      "docs/decisions/custom.md",
    );
  });
});
