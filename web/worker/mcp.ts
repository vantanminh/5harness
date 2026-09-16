import { getBearerToken, verifyFirebaseIdToken } from "./auth";
import {
  findEntity,
  MCP_SEQUENTIAL_GUIDE,
  paginateEntities,
  projectOverview,
  searchCatalog,
  validateCatalog,
} from "./catalog";
import { withCors } from "./cors";
import { ApiError } from "./errors";
import {
  listProjects,
  projectMetadata,
  readCatalog,
  readPlan,
  readProject,
  refreshFirebaseIdToken,
  writePlan,
} from "./firestore";
import { usageFor } from "./limits";
import { validatePlanInput, validatePlanToken } from "./plans";
import { isValidProjectId, SYNC_READ_SCOPE, SYNC_WRITE_SCOPE } from "./protocol";
import type { Env, HarnessOAuthProps } from "./types";

export const MCP_ROUTE = "/mcp";

const tools = [
  {
    name: "harness_cloud_guide",
    description:
      "Sequential-read instructions for this MCP. Call first. Harness-only: stories, decisions, intakes, backlog, reports — not source code.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "harness_projects",
    description: "List the authenticated user's synced Harness projects. Pick one the user named before reading entities.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "harness_project_overview",
    description: "Summary counts and recently updated harness entities for one designated project.",
    inputSchema: {
      type: "object",
      required: ["project_id"],
      properties: { project_id: { type: "string" } },
    },
  },
  {
    name: "harness_entities",
    description: "Page harness entities for a designated project. Filter by type; use limit/offset; do not dump the vault.",
    inputSchema: {
      type: "object",
      required: ["project_id"],
      properties: {
        project_id: { type: "string" },
        type: { type: "string" },
        limit: { type: "integer" },
        offset: { type: "integer" },
      },
    },
  },
  {
    name: "harness_search",
    description: "Search harness entities in one designated project (id, title, status, body snippets).",
    inputSchema: {
      type: "object",
      required: ["project_id", "query"],
      properties: {
        project_id: { type: "string" },
        query: { type: "string" },
        limit: { type: "integer" },
      },
    },
  },
  {
    name: "harness_get",
    description: "Read one harness entity by id or path from a designated project.",
    inputSchema: {
      type: "object",
      required: ["project_id", "id"],
      properties: { project_id: { type: "string" }, id: { type: "string" } },
    },
  },
  {
    name: "harness_plan_create",
    description:
      "Store a detailed implementation brief in Harness Cloud. Returns a unique token and the exact handoff command `please implement plan from harness --TOKEN`. Requires sync:write.",
    inputSchema: {
      type: "object",
      required: ["project_id", "title", "idea", "plan_markdown", "implement_prompt"],
      properties: {
        project_id: { type: "string" },
        title: { type: "string" },
        idea: { type: "string" },
        research_notes: { type: "string" },
        plan_markdown: { type: "string" },
        implement_prompt: { type: "string" },
        client_name: { type: "string" },
      },
    },
  },
  {
    name: "harness_plan_get",
    description: "Load a cloud implementation brief by token, including the full coding-agent prompt.",
    inputSchema: {
      type: "object",
      required: ["token"],
      properties: { token: { type: "string" } },
    },
  },
  {
    name: "harness_sync_projects",
    description: "List encrypted snapshot metadata for the authenticated user.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "harness_sync_usage",
    description: "Read the authenticated user's current daily Harness sync usage.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "harness_sync_snapshot",
    description: "Read one encrypted Harness snapshot by project id (ciphertext, not markdown).",
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

export function validateOAuthGrantProps(
  value: unknown,
  tokenUserId: string,
  env: Pick<Env, "FIREBASE_PROJECT_ID" | "FIREBASE_API_KEY">,
): HarnessOAuthProps {
  const props = propsFromToken(value);
  if (
    props.uid !== tokenUserId ||
    props.projectId !== env.FIREBASE_PROJECT_ID ||
    props.firebaseApiKey !== env.FIREBASE_API_KEY
  ) {
    throw new ApiError(401, "invalid_token", "Harness OAuth grant is not valid for this Worker.");
  }
  return props;
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
  const props = validateOAuthGrantProps(tokenData.grant.props, tokenData.userId, env);
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
    FIREBASE_PROJECT_ID: env.FIREBASE_PROJECT_ID,
  });
  if (user.uid !== props.uid) {
    throw new ApiError(401, "invalid_token", "Harness OAuth grant identity no longer matches Firebase.");
  }
  return {
    token,
    uid: user.uid,
    firestoreEnv: {
      ...env,
      FIREBASE_PROJECT_ID: env.FIREBASE_PROJECT_ID,
      FIRESTORE_API_BASE_URL: props.firestoreApiBaseUrl,
    },
  };
}

async function loadCatalog(
  context: { token: string; uid: string; firestoreEnv: Env },
  projectIdUnknown: unknown,
) {
  if (!isValidProjectId(projectIdUnknown)) {
    throw new ApiError(400, "invalid_project_id", "Project id is invalid.");
  }
  const raw = await readCatalog(
    context.token,
    context.firestoreEnv,
    context.uid,
    projectIdUnknown,
  );
  const catalog = raw ? validateCatalog(raw, projectIdUnknown) : null;
  if (!catalog) {
    throw new ApiError(
      404,
      "catalog_not_found",
      "No AI-readable harness catalog exists for this project. Sync from a current CLI, then retry.",
    );
  }
  return catalog;
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  request: Request,
  env: Env,
): Promise<unknown> {
  const { props, scopes } = await authenticatedContext(request, env);
  const context = await firebaseContext(props, env);
  if (name === "harness_cloud_guide") {
    return {
      guide: MCP_SEQUENTIAL_GUIDE,
      handoff_example: "please implement plan from harness --kfkadjakdnjkad",
      coding_agent: "harness plan get <token>",
    };
  }
  if (name === "harness_projects" || name === "harness_sync_projects") {
    const projects = await listProjects(context.token, context.firestoreEnv, context.uid);
    return { projects: projects.map(projectMetadata) };
  }
  if (name === "harness_sync_usage") {
    return usageFor(env, context.uid);
  }
  if (name === "harness_project_overview") {
    const catalog = await loadCatalog(context, args.project_id);
    return { project_id: catalog.project_id, ...projectOverview(catalog.entities) };
  }
  if (name === "harness_entities") {
    const catalog = await loadCatalog(context, args.project_id);
    const limit = typeof args.limit === "number" ? args.limit : 20;
    const offset = typeof args.offset === "number" ? args.offset : 0;
    const type = typeof args.type === "string" ? args.type : undefined;
    return { project_id: catalog.project_id, ...paginateEntities(catalog.entities, type, limit, offset) };
  }
  if (name === "harness_search") {
    const catalog = await loadCatalog(context, args.project_id);
    const query = typeof args.query === "string" ? args.query : "";
    const limit = typeof args.limit === "number" ? args.limit : 20;
    return {
      project_id: catalog.project_id,
      query,
      hits: searchCatalog(catalog.entities, query, limit),
    };
  }
  if (name === "harness_get") {
    const catalog = await loadCatalog(context, args.project_id);
    const id = typeof args.id === "string" ? args.id : "";
    const entity = findEntity(catalog.entities, id);
    if (!entity) throw new ApiError(404, "entity_not_found", "Harness entity was not found.");
    return { project_id: catalog.project_id, entity };
  }
  if (name === "harness_plan_create") {
    if (!scopes.includes(SYNC_WRITE_SCOPE)) {
      throw new ApiError(403, "insufficient_scope", "Creating a plan requires sync:write.");
    }
    const plan = validatePlanInput(args, { uid: context.uid });
    if (!plan) throw new ApiError(400, "invalid_plan", "Implementation brief is invalid.");
    await writePlan(
      context.token,
      context.firestoreEnv,
      context.uid,
      plan as unknown as Record<string, unknown>,
    );
    return {
      token: plan.token,
      project_id: plan.project_id,
      title: plan.title,
      handoff_command: plan.handoff_command,
      coding_agent: "harness plan get " + plan.token,
    };
  }
  if (name === "harness_plan_get") {
    const token = typeof args.token === "string" ? args.token.trim().replace(/^-+/, "") : "";
    if (!validatePlanToken(token)) {
      throw new ApiError(400, "invalid_plan_token", "Plan token is invalid.");
    }
    const plan = await readPlan(context.token, context.firestoreEnv, context.uid, token);
    if (!plan) throw new ApiError(404, "plan_not_found", "Plan was not found.");
    return plan;
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
    let requestId: unknown = null;
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
      requestId = id ?? null;
      const method = typeof message.method === "string" ? message.method : "";
      if (method === "initialize") {
        return withCors(
          request,
          env,
          rpcResult(id, {
            protocolVersion: "2025-06-18",
            capabilities: { tools: {} },
            instructions: MCP_SEQUENTIAL_GUIDE,
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
        return withCors(request, env, rpcError(requestId, -32001, message));
      }
      return withCors(request, env, rpcError(requestId, -32000, message));
    }
  },
};
