import { getBearerToken, verifyFirebaseIdToken } from "./auth";
import { errorJson, withCors } from "./cors";
import { ApiError } from "./errors";
import { listProjects, projectMetadata, readProject, refreshFirebaseIdToken } from "./firestore";
import { usageFor } from "./limits";
import { isValidProjectId, SYNC_READ_SCOPE } from "./protocol";
import type { Env, HarnessOAuthProps } from "./types";

export const MCP_ROUTE = "/mcp";

const tools = [
  {
    name: "harness_sync_projects",
    description: "List the authenticated user's live encrypted Harness snapshots.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "harness_sync_usage",
    description: "Read the authenticated user's current daily Harness sync usage.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "harness_sync_snapshot",
    description: "Read one encrypted Harness snapshot by project id.",
    inputSchema: {
      type: "object",
      required: ["project_id"],
      properties: { project_id: { type: "string" } },
    },
  },
];

function rpcResult(id: unknown, result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result });
}

function rpcError(id: unknown, code: number, message: string): Response {
  return Response.json({
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message },
  });
}

function propsFromToken(value: unknown): HarnessOAuthProps {
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as Partial<HarnessOAuthProps>).uid !== "string" ||
    typeof (value as Partial<HarnessOAuthProps>).projectId !== "string" ||
    typeof (value as Partial<HarnessOAuthProps>).firebaseApiKey !== "string" ||
    typeof (value as Partial<HarnessOAuthProps>).firebaseRefreshToken !== "string"
  ) {
    throw new ApiError(401, "invalid_token", "Harness OAuth grant is incomplete.");
  }
  return value as HarnessOAuthProps;
}

async function authenticatedContext(
  request: Request,
  env: Env,
): Promise<{ props: HarnessOAuthProps; scopes: string[] }> {
  const token = getBearerToken(request);
  const tokenData = await env.OAUTH_PROVIDER?.unwrapToken(token);
  if (!tokenData) throw new ApiError(401, "invalid_token", "Harness access token is invalid.");
  const scopes = Array.isArray(tokenData.scope) ? tokenData.scope : [];
  if (!scopes.includes(SYNC_READ_SCOPE)) {
    throw new ApiError(403, "insufficient_scope", "This MCP call requires sync:read.");
  }
  const props = propsFromToken(tokenData.grant.props);
  if (props.projectId !== env.FIREBASE_PROJECT_ID) {
    throw new ApiError(401, "invalid_token", "Harness OAuth grant belongs to another project.");
  }
  return { props, scopes };
}

async function firebaseContext(
  props: HarnessOAuthProps,
  env: Env,
): Promise<{ token: string; uid: string; firestoreEnv: Env }> {
  const token = await refreshFirebaseIdToken(
    props.firebaseRefreshToken,
    props.firebaseApiKey,
  );
  const user = await verifyFirebaseIdToken(token, {
    FIREBASE_PROJECT_ID: props.projectId,
  });
  if (user.uid !== props.uid) {
    throw new ApiError(401, "invalid_token", "Harness OAuth grant identity no longer matches Firebase.");
  }
  return {
    token,
    uid: user.uid,
    firestoreEnv: {
      ...env,
      FIREBASE_PROJECT_ID: props.projectId,
      FIRESTORE_API_BASE_URL: props.firestoreApiBaseUrl,
    },
  };
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  request: Request,
  env: Env,
): Promise<unknown> {
  const { props } = await authenticatedContext(request, env);
  const context = await firebaseContext(props, env);
  if (name === "harness_sync_projects") {
    const projects = await listProjects(context.token, context.firestoreEnv, context.uid);
    return { projects: projects.map(projectMetadata) };
  }
  if (name === "harness_sync_usage") {
    return usageFor(env, context.uid);
  }
  if (name === "harness_sync_snapshot") {
    const projectId = args.project_id;
    if (!isValidProjectId(projectId)) {
      throw new ApiError(400, "invalid_project_id", "Project id is invalid.");
    }
    const record = await readProject(
      context.token,
      context.firestoreEnv,
      context.uid,
      projectId,
    );
    if (!record) throw new ApiError(404, "snapshot_not_found", "Snapshot was not found.");
    return {
      has_snapshot: true,
      project_id: projectId,
      revision: record.revision,
      created_at: record.createdAt,
      updated_at: record.updatedAt,
      envelope: record.envelope,
    };
  }
  throw new ApiError(404, "tool_not_found", "MCP tool was not found.");
}

/** Small stateless MCP surface secured by the same OAuth/KV boundary. */
export const mcpApiHandler = {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return withCors(request, env, new Response(null, { status: 204 }));
    }
    try {
      const token = getBearerToken(request);
      const tokenData = await env.OAUTH_PROVIDER?.unwrapToken(token);
      if (!tokenData) throw new ApiError(401, "invalid_token", "Harness access token is invalid.");
      if (!tokenData.scope.includes(SYNC_READ_SCOPE)) {
        return withCors(
          request,
          env,
          new Response(
            JSON.stringify({
              error: "insufficient_scope",
              scope: SYNC_READ_SCOPE,
            }),
            {
              status: 403,
              headers: {
                "Content-Type": "application/json; charset=utf-8",
                "WWW-Authenticate": 'Bearer error="insufficient_scope" scope="sync:read"',
              },
            },
          ),
        );
      }
      const body = request.method === "POST" ? await request.json() : {};
      const message =
        body && typeof body === "object" && !Array.isArray(body)
          ? (body as { id?: unknown; method?: unknown; params?: unknown })
          : {};
      const id = message.id;
      const method = typeof message.method === "string" ? message.method : "";
      if (method === "initialize") {
        return withCors(
          request,
          env,
          rpcResult(id, {
            protocolVersion: "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "5harness Cloud", version: "1" },
          }),
        );
      }
      if (method === "notifications/initialized") {
        return withCors(request, env, new Response(null, { status: 202 }));
      }
      if (method === "tools/list") {
        return withCors(request, env, rpcResult(id, { tools }));
      }
      if (method === "tools/call") {
        const params =
          message.params && typeof message.params === "object"
            ? (message.params as { name?: unknown; arguments?: unknown })
            : {};
        const name = typeof params.name === "string" ? params.name : "";
        const args =
          params.arguments && typeof params.arguments === "object"
            ? (params.arguments as Record<string, unknown>)
            : {};
        const result = await callTool(name, args, request, env);
        return withCors(
          request,
          env,
          rpcResult(id, {
            content: [{ type: "text", text: JSON.stringify(result) }],
          }),
        );
      }
      return withCors(request, env, rpcError(id, -32601, "MCP method was not found."));
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 500;
      const message =
        error instanceof ApiError ? error.message : "Harness MCP request failed.";
      console.error("Harness MCP request failed", error instanceof Error ? error.name : "unknown");
      if (status === 401 || status === 403) {
        return withCors(request, env, rpcError(null, -32001, message));
      }
      return withCors(request, env, rpcError(null, -32000, message));
    }
  },
};
