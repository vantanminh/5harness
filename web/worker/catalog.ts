export const MAX_CATALOG_ENTITIES = 400;
export const MAX_ENTITY_BODY_CHARS = 24_000;
export const MAX_PAGE_SIZE = 50;
export const ENTITY_TYPES = ["story", "decision", "intake", "backlog", "report"] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export interface CatalogEntity {
  id: string;
  type: EntityType;
  path: string;
  title: string;
  status: string;
  body: string;
}

export interface SyncCatalog {
  schema_version: 1;
  project_id: string;
  generated_at: string;
  entities: CatalogEntity[];
}

export const MCP_SEQUENTIAL_GUIDE = `You are connected to 5harness Cloud MCP with the user's account. Read only durable Harness history (stories, decisions, intakes, backlog, reports) for one project the user designates. Do not assume access to source code, .5harness, credentials, or traces.

Read in this order, one step at a time:
1. harness_cloud_guide — these instructions (optional if you already have them).
2. harness_projects — list synced projects. If the user named a project, match it. Otherwise list ids/names and ask.
3. harness_project_overview — counts plus recently updated entities. Do not dump the catalog.
4. harness_search or harness_entities — filter by type (story, decision, intake, backlog, report). Use limit/offset.
5. harness_get — read full markdown for each entity you actually need, by id.
6. After you understand the project and have researched the idea, call harness_plan_create with project_id, title, idea, research_notes, plan_markdown, and implement_prompt (complete instructions for a coding agent).
7. Your user-visible answer MUST include this exact handoff line, using the token returned by harness_plan_create:
please implement plan from harness --<token>
Do not invent a token. Coding agents load the brief with: harness plan get <token>`;

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/;

function isEntityType(value: unknown): value is EntityType {
  return typeof value === "string" && (ENTITY_TYPES as readonly string[]).includes(value);
}

export function validateCatalogEntity(value: unknown): CatalogEntity | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string" || !ID_RE.test(item.id)) return null;
  if (!isEntityType(item.type)) return null;
  if (typeof item.path !== "string" || item.path.length > 400 || item.path.includes("..")) {
    return null;
  }
  if (typeof item.title !== "string" || item.title.length > 300) return null;
  if (typeof item.status !== "string" || item.status.length > 80) return null;
  if (typeof item.body !== "string" || item.body.length > MAX_ENTITY_BODY_CHARS + 8) return null;
  return {
    id: item.id,
    type: item.type,
    path: item.path,
    title: item.title,
    status: item.status,
    body: item.body,
  };
}

export function validateCatalog(value: unknown, projectId: string): SyncCatalog | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw.schema_version !== 1 || raw.project_id !== projectId) return null;
  if (typeof raw.generated_at !== "string" || raw.generated_at.length > 40) return null;
  if (!Array.isArray(raw.entities) || raw.entities.length > MAX_CATALOG_ENTITIES) return null;
  const entities: CatalogEntity[] = [];
  for (const item of raw.entities) {
    const entity = validateCatalogEntity(item);
    if (!entity) return null;
    entities.push(entity);
  }
  return {
    schema_version: 1,
    project_id: projectId,
    generated_at: raw.generated_at,
    entities,
  };
}

export function paginateEntities(
  entities: CatalogEntity[],
  type: string | undefined,
  limit: number,
  offset: number,
): { entities: CatalogEntity[]; total: number } {
  const filtered = type && isEntityType(type) ? entities.filter((item) => item.type === type) : entities;
  const size = Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);
  const start = Math.max(offset, 0);
  return {
    entities: filtered.slice(start, start + size).map((item) => ({
      ...item,
      body: item.body.length > 400 ? item.body.slice(0, 400) + "…" : item.body,
    })),
    total: filtered.length,
  };
}

export function searchCatalog(
  entities: CatalogEntity[],
  query: string,
  limit: number,
): CatalogEntity[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const size = Math.min(Math.max(limit, 1), MAX_PAGE_SIZE);
  const hits: CatalogEntity[] = [];
  for (const item of entities) {
    const haystack = `${item.id} ${item.type} ${item.title} ${item.status} ${item.path} ${item.body}`.toLowerCase();
    if (!haystack.includes(needle)) continue;
    hits.push({
      ...item,
      body: item.body.length > 400 ? item.body.slice(0, 400) + "…" : item.body,
    });
    if (hits.length >= size) break;
  }
  return hits;
}

export function projectOverview(entities: CatalogEntity[]): Record<string, unknown> {
  const counts: Record<string, number> = {};
  for (const type of ENTITY_TYPES) counts[type] = 0;
  for (const item of entities) counts[item.type] = (counts[item.type] ?? 0) + 1;
  const recent = [...entities]
    .slice(-12)
    .reverse()
    .map((item) => ({
      id: item.id,
      type: item.type,
      title: item.title,
      status: item.status,
      path: item.path,
    }));
  return {
    entity_count: entities.length,
    counts,
    recent,
    next: "Call harness_search or harness_entities, then harness_get for full markdown.",
  };
}

export function findEntity(entities: CatalogEntity[], id: string): CatalogEntity | null {
  const needle = id.trim();
  return entities.find((item) => item.id === needle || item.path === needle) ?? null;
}
