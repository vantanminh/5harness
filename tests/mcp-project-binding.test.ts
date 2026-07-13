import { describe, expect, it } from "vitest";
import { resolveMcpProjectBinding } from "../src/application/mcp-project-binding.js";
import type { ListedProject } from "../src/domain/registry.js";

const projects: ListedProject[] = [
  {
    id: "project-a",
    name: "A",
    path: "/projects/a",
    linked_at: "t1",
    updated_at: "t1",
    remote: null,
    missing: false,
  },
  {
    id: "project-b",
    name: "B",
    path: "/projects/b",
    linked_at: "t1",
    updated_at: "t1",
    remote: null,
    missing: true,
  },
];

describe("MCP project binding", () => {
  it("forces a single grant and rejects conflicting client hints", () => {
    const grant = { projectMode: "single" as const, projectIds: ["project-a"] };
    expect(resolveMcpProjectBinding(grant, projects)).toEqual({
      ok: true,
      binding: {
        projectId: "project-a",
        projectRoot: "/projects/a",
        projectMode: "single",
      },
    });
    expect(
      resolveMcpProjectBinding(grant, projects, { header: "project-b" }),
    ).toMatchObject({ ok: false, code: "project_hint_mismatch" });
  });

  it("requires a canonical project id for all-project grants", () => {
    const grant = { projectMode: "all" as const, projectIds: [] };
    expect(resolveMcpProjectBinding(grant, projects)).toMatchObject({
      ok: false,
      code: "project_required",
    });
    expect(
      resolveMcpProjectBinding(grant, projects, { query: "unknown" }),
    ).toMatchObject({ ok: false, code: "project_not_linked" });
    expect(
      resolveMcpProjectBinding(grant, projects, { header: "project-b" }),
    ).toMatchObject({ ok: false, code: "project_unavailable" });
    expect(
      resolveMcpProjectBinding(grant, projects, { header: "project-a" }),
    ).toMatchObject({
      ok: true,
      binding: { projectId: "project-a", projectMode: "all" },
    });
  });

  it("rejects conflicting header and query ids", () => {
    expect(
      resolveMcpProjectBinding(
        { projectMode: "all", projectIds: [] },
        projects,
        { header: "project-a", query: "project-b" },
      ),
    ).toMatchObject({ ok: false, code: "conflicting_project_hint" });
  });
});
