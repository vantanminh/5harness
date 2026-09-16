import { describe, expect, it } from "vitest";
import {
  findEntity,
  MCP_SEQUENTIAL_GUIDE,
  paginateEntities,
  projectOverview,
  searchCatalog,
  validateCatalog,
} from "./catalog";

const catalog = {
  schema_version: 1 as const,
  project_id: "project-1234567890ab",
  generated_at: "2026-09-16T00:00:00.000Z",
  entities: [
    {
      id: "US-001",
      type: "story" as const,
      path: "docs/stories/US-001.md",
      title: "Export API",
      status: "planned",
      body: "# Export API\nAdd an export endpoint.",
    },
    {
      id: "IN-001",
      type: "intake" as const,
      path: "docs/intakes/IN-001.md",
      title: "Export",
      status: "open",
      body: "Need export.",
    },
  ],
};

describe("hosted MCP catalog", () => {
  it("validates a designated-project catalog and pages reads", () => {
    expect(validateCatalog(catalog, "project-1234567890ab")).toEqual(catalog);
    expect(validateCatalog(catalog, "other-project-id000")).toBeNull();
    const page = paginateEntities(catalog.entities, "story", 20, 0);
    expect(page.total).toBe(1);
    expect(page.entities[0]?.id).toBe("US-001");
    expect(searchCatalog(catalog.entities, "export endpoint", 10)[0]?.id).toBe("US-001");
    expect(findEntity(catalog.entities, "IN-001")?.type).toBe("intake");
    const overview = projectOverview(catalog.entities);
    expect(overview.entity_count).toBe(2);
    expect((overview.counts as Record<string, number>).story).toBe(1);
  });

  it("tells web AIs to read sequentially and hand a plan token", () => {
    expect(MCP_SEQUENTIAL_GUIDE).toContain("harness_projects");
    expect(MCP_SEQUENTIAL_GUIDE).toContain("harness_get");
    expect(MCP_SEQUENTIAL_GUIDE).toContain("harness_plan_create");
    expect(MCP_SEQUENTIAL_GUIDE).toContain("please implement plan from harness --");
    expect(MCP_SEQUENTIAL_GUIDE).toContain("source code");
  });
});
