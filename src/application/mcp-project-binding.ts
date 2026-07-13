import type { ListedProject } from "../domain/registry.js";
import type { McpProjectGrant } from "./mcp-oauth.js";

export type McpProjectBinding = {
  projectId: string;
  projectRoot: string;
  projectMode: "single" | "all";
};

export type McpProjectBindingResult =
  | { ok: true; binding: McpProjectBinding }
  | {
      ok: false;
      code:
        | "conflicting_project_hint"
        | "invalid_project_grant"
        | "project_hint_mismatch"
        | "project_required"
        | "project_not_linked"
        | "project_unavailable";
      message: string;
    };

export function resolveMcpProjectBinding(
  grant: McpProjectGrant,
  projects: ListedProject[],
  hints: { header?: string; query?: string } = {},
): McpProjectBindingResult {
  const header = hints.header?.trim() || undefined;
  const query = hints.query?.trim() || undefined;
  if (header && query && header !== query) {
    return {
      ok: false,
      code: "conflicting_project_hint",
      message: "X-Harness-Project and ?project= identify different projects.",
    };
  }
  const hintedId = header ?? query;

  let projectId: string;
  if (grant.projectMode === "single") {
    if (grant.projectIds.length !== 1 || !grant.projectIds[0]) {
      return {
        ok: false,
        code: "invalid_project_grant",
        message: "Single-project access token has an invalid project grant.",
      };
    }
    projectId = grant.projectIds[0];
    if (hintedId && hintedId !== projectId) {
      return {
        ok: false,
        code: "project_hint_mismatch",
        message: "Requested project does not match the token's single-project grant.",
      };
    }
  } else {
    if (!hintedId) {
      return {
        ok: false,
        code: "project_required",
        message:
          "All-project access requires X-Harness-Project or ?project= on every MCP call.",
      };
    }
    projectId = hintedId;
  }

  const project = projects.find((candidate) => candidate.id === projectId);
  if (!project) {
    return {
      ok: false,
      code: "project_not_linked",
      message: `Project id ${projectId} is not linked on this machine.`,
    };
  }
  if (project.missing) {
    return {
      ok: false,
      code: "project_unavailable",
      message: `Project id ${projectId} is linked but missing on disk.`,
    };
  }

  return {
    ok: true,
    binding: {
      projectId,
      projectRoot: project.path,
      projectMode: grant.projectMode,
    },
  };
}
