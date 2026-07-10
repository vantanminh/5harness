import { updateStoryMd } from "./md-durable.js";
import { closeBacklogMd } from "./md-durable.js";
import { writeProjectIndex } from "./index-store.js";

/** Check mutation opt-in: requires X-Harness-Mutation: allow header or query param ?mutation=allow */
export function allowDashboardMutation(
  method: string,
  url: URL,
  headers?: Record<string, string | string[] | undefined>,
): boolean {
  if (method !== "POST" && method !== "PUT" && method !== "PATCH") return false;
  const param = url.searchParams.get("mutation");
  if (param === "allow") return true;
  const headerVal = headers?.["x-harness-mutation"] ?? headers?.["X-Harness-Mutation"];
  if (Array.isArray(headerVal)) return headerVal.includes("allow");
  return headerVal === "allow";
}

export function handleDashboardMutation(
  method: string,
  url: URL,
  body: string,
  headers?: Record<string, string | string[] | undefined>,
): { status: number; contentType: string; body: string } {
  if (!allowDashboardMutation(method, url, headers)) {
    return {
      status: 403,
      contentType: "text/plain",
      body: "Mutations require X-Harness-Mutation: allow header or ?mutation=allow",
    };
  }

  try {
    const payload = JSON.parse(body) as Record<string, unknown>;

    if (url.pathname === "/api/story/update") {
      const projectRoot = String(payload.project ?? "");
      if (!projectRoot) {
        return { status: 400, contentType: "text/plain", body: "Missing: project" };
      }
      const result = updateStoryMd(
        { projectRoot },
        {
          id: String(payload.id ?? ""),
          status: payload.status as string | undefined,
          evidence: payload.evidence as string | undefined,
          unit: payload.unit as string | undefined,
          integration: payload.integration as string | undefined,
          e2e: payload.e2e as string | undefined,
          platform: payload.platform as string | undefined,
          notes: payload.notes as string | undefined,
        },
      );
      writeProjectIndex(projectRoot);
      return {
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, id: payload.id, path: result.relativePath }),
      };
    }

    if (url.pathname === "/api/backlog/close") {
      const projectRoot = String(payload.project ?? "");
      if (!projectRoot) {
        return { status: 400, contentType: "text/plain", body: "Missing: project" };
      }
      const result = closeBacklogMd(
        { projectRoot },
        {
          id: String(payload.id ?? ""),
          status: (payload.status as string) ?? "implemented",
          outcome: payload.outcome as string | undefined,
        },
      );
      writeProjectIndex(projectRoot);
      return {
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, id: payload.id, path: result.relativePath }),
      };
    }

    return { status: 404, contentType: "text/plain", body: "Unknown mutation endpoint" };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 400, contentType: "text/plain", body: msg };
  }
}