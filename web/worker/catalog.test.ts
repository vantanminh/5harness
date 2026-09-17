import { describe, expect, it } from "vitest";
import {
  findEntity,
  MAX_ENTITY_BODY_CHARS,
  MAX_ENTITY_STATUS_CHARS,
  MAX_ENTITY_TITLE_CHARS,
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

  it("normalizes oversized derived catalog fields", () => {
    const normalized = validateCatalog(
      {
        ...catalog,
        entities: [
          {
            ...catalog.entities[0],
            title: "t".repeat(MAX_ENTITY_TITLE_CHARS + 20),
            status: "s".repeat(MAX_ENTITY_STATUS_CHARS + 20),
            body: "b".repeat(MAX_ENTITY_BODY_CHARS + 8),
          },
        ],
      },
      catalog.project_id,
    );

    expect(normalized?.entities[0]?.title).toHaveLength(MAX_ENTITY_TITLE_CHARS);
    expect(normalized?.entities[0]?.title.endsWith("…")).toBe(true);
    expect(normalized?.entities[0]?.status).toHaveLength(MAX_ENTITY_STATUS_CHARS);
    expect(normalized?.entities[0]?.status.endsWith("…")).toBe(true);
    expect(normalized?.entities[0]?.body).toHaveLength(MAX_ENTITY_BODY_CHARS);
    expect(normalized?.entities[0]?.body.endsWith("…")).toBe(true);
  });
});
