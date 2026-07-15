import type { DatabaseSync } from "node:sqlite";
import {
  parseBacklogStatus,
  parseDecisionStatus,
  parseInputType,
  parseIntakeStatus,
  parseProofFlag,
  parseRiskLane,
  parseStoryStatus,
  type BacklogStatus,
  type DecisionStatus,
} from "../domain/enums.js";
import {
  entityRelativePath,
  parseLinksCsv,
  sanitizeEntityId,
} from "../domain/entities.js";
import {
  asBoolean01,
  asString,
  asStringArray,
  type FrontmatterData,
} from "../domain/frontmatter.js";
import {
  ensureEntityDirs,
  listEntityFiles,
  nextNumericEntityId,
  readEntityById,
  readEntityFile,
  writeEntityFile,
  type EntityFile,
} from "../infrastructure/entities.js";
import type {
  BacklogAddInput,
  BacklogCloseInput,
  DecisionAddInput,
  IntakeInput,
  StoryAddInput,
  StoryUpdateInput,
} from "./durable.js";
import {
  addBacklog as addBacklogDb,
  addDecision as addDecisionDb,
  addIntake as addIntakeDb,
  addStory as addStoryDb,
  closeBacklog as closeBacklogDb,
  updateStory as updateStoryDb,
} from "./durable.js";

export type MdWriteMeta = {
  projectRoot: string;
  /** When set, dual-write to SQLite for transition until US-008/013. */
  db?: DatabaseSync | null;
};

function nowIso(): string {
  return new Date().toISOString();
}

function withLinks(
  data: FrontmatterData,
  linksCsv?: string,
): FrontmatterData {
  const links = parseLinksCsv(linksCsv);
  if (links === undefined) return data;
  return { ...data, links };
}

export type StoryWriteInput = StoryAddInput & { links?: string };

export function addStoryMd(
  meta: MdWriteMeta,
  input: StoryWriteInput,
): EntityFile {
  const id = sanitizeEntityId(input.id);
  const lane = parseRiskLane(input.lane);
  ensureEntityDirs(meta.projectRoot);

  const existing = readEntityById(meta.projectRoot, "story", id);
  if (existing) {
    throw new Error(`Story ${id} already exists. Use story update.`);
  }

  const relativePath = entityRelativePath("story", id);
  const data: FrontmatterData = withLinks(
    {
      id,
      type: "story",
      title: input.title,
      status: "planned",
      lane,
      unit: 0,
      integration: 0,
      e2e: 0,
      platform: 0,
      contract: input.contract ?? null,
      verify: input.verify ?? null,
      evidence: null,
      notes: input.notes ?? null,
      created_at: nowIso(),
      updated_at: nowIso(),
    },
    input.links,
  );

  const body = `# ${input.title}\n\n`;
  const file = writeEntityFile(meta.projectRoot, relativePath, data, body);

  if (meta.db) {
    addStoryDb(meta.db, input);
  }
  return file;
}

export type StoryUpdateWriteInput = StoryUpdateInput & { links?: string };

export function updateStoryMd(
  meta: MdWriteMeta,
  input: StoryUpdateWriteInput,
): EntityFile {
  const id = sanitizeEntityId(input.id);
  ensureEntityDirs(meta.projectRoot);

  let file = readEntityById(meta.projectRoot, "story", id);
  // Transition: story may exist only in SQLite (pre-US-007). Materialize MD then update.
  if (!file && meta.db) {
    const row = meta.db
      .prepare(
        `SELECT id, title, status, risk_lane, unit_proof, integration_proof,
                e2e_proof, platform_proof, contract_doc, verify_command,
                evidence, notes
         FROM story WHERE id = ?`,
      )
      .get(id) as
      | {
          id: string;
          title: string;
          status: string;
          risk_lane: string;
          unit_proof: number;
          integration_proof: number;
          e2e_proof: number;
          platform_proof: number;
          contract_doc: string | null;
          verify_command: string | null;
          evidence: string | null;
          notes: string | null;
        }
      | undefined;
    if (row) {
      const relativePath = entityRelativePath("story", id);
      const seed: FrontmatterData = {
        id,
        type: "story",
        title: row.title,
        status: row.status,
        lane: row.risk_lane,
        unit: row.unit_proof ? 1 : 0,
        integration: row.integration_proof ? 1 : 0,
        e2e: row.e2e_proof ? 1 : 0,
        platform: row.platform_proof ? 1 : 0,
        contract: row.contract_doc,
        verify: row.verify_command,
        evidence: row.evidence,
        notes: row.notes,
        created_at: nowIso(),
        updated_at: nowIso(),
      };
      file = writeEntityFile(
        meta.projectRoot,
        relativePath,
        seed,
        `# ${row.title}\n\n`,
      );
    }
  }
  if (!file) {
    throw new Error(`Story ${id} not found`);
  }

  const data: FrontmatterData = { ...file.data, id, type: "story" };
  let changed = false;

  if (input.status !== undefined) {
    data.status = parseStoryStatus(input.status);
    changed = true;
  }
  if (input.evidence !== undefined) {
    data.evidence = input.evidence;
    changed = true;
  }
  if (input.unit !== undefined) {
    data.unit = parseProofFlag(input.unit, "unit");
    changed = true;
  }
  if (input.integration !== undefined) {
    data.integration = parseProofFlag(input.integration, "integration");
    changed = true;
  }
  if (input.e2e !== undefined) {
    data.e2e = parseProofFlag(input.e2e, "e2e");
    changed = true;
  }
  if (input.platform !== undefined) {
    data.platform = parseProofFlag(input.platform, "platform");
    changed = true;
  }
  if (input.verify !== undefined) {
    data.verify = input.verify;
    changed = true;
  }
  if (input.title !== undefined) {
    data.title = input.title;
    changed = true;
  }
  if (input.notes !== undefined) {
    data.notes = input.notes;
    changed = true;
  }
  if (input.contract !== undefined) {
    data.contract = input.contract;
    changed = true;
  }
  if (input.links !== undefined) {
    data.links = parseLinksCsv(input.links) ?? [];
    changed = true;
  }

  if (!changed) {
    throw new Error("story update requires at least one field to change");
  }

  data.updated_at = nowIso();
  // keep proof keys as 0/1 numbers
  for (const k of ["unit", "integration", "e2e", "platform"] as const) {
    const b = asBoolean01(data, k);
    if (b !== undefined) data[k] = b;
  }

  const written = writeEntityFile(
    meta.projectRoot,
    file.relativePath,
    data,
    file.body,
  );

  if (input.status !== undefined && data.status === "implemented") {
    autoCompleteEligibleIntakes(meta.projectRoot);
  }

  if (meta.db) {
    try {
      updateStoryDb(meta.db, input);
    } catch {
      // story may only exist in MD during transition
      try {
        addStoryDb(meta.db, {
          id,
          title: String(data.title ?? id),
          lane: String(data.lane ?? "normal"),
          contract: asString(data, "contract"),
          verify: asString(data, "verify"),
          notes: asString(data, "notes"),
        });
        updateStoryDb(meta.db, input);
      } catch {
        // dual-write best-effort
      }
    }
  }
  return written;
}

export type DecisionWriteInput = DecisionAddInput & { links?: string; force?: boolean };

export function addDecisionMd(
  meta: MdWriteMeta,
  input: DecisionWriteInput,
): EntityFile {
  const id = sanitizeEntityId(input.id);
  const status: DecisionStatus = input.status
    ? parseDecisionStatus(input.status)
    : "accepted";
  ensureEntityDirs(meta.projectRoot);

  const relativePath = entityRelativePath(
    "decision",
    id,
    input.doc /* file-is-the-doc when under project */,
  );

  const existing = readEntityFile(meta.projectRoot, relativePath);
  if (existing) {
    if (input.force) {
      // Overwrite: keep the same file path, replace content.
      const data: FrontmatterData = withLinks(
        {
          id,
          type: "decision",
          title: input.title,
          status,
          doc: relativePath,
          verify: input.verify ?? null,
          notes: input.notes ?? null,
          created_at:
            (existing.data.created_at as string) ?? nowIso(),
          updated_at: nowIso(),
        },
        input.links,
      );
      const body = `# ${input.title}\n\n`;
      const file = writeEntityFile(
        meta.projectRoot,
        relativePath,
        data,
        body,
      );
      if (meta.db) {
        addDecisionDb(meta.db, {
          ...input,
          doc: relativePath,
        });
      }
      return file;
    }
    throw new Error(`Decision ${id} already exists. Use force=true to overwrite.`);
  }
  // also guard default path if custom doc differs
  const defaultPath = entityRelativePath("decision", id);
  if (
    relativePath !== defaultPath &&
    readEntityById(meta.projectRoot, "decision", id)
  ) {
    if (input.force) {
      // Overwrite at the default path location.
      const existingDefault = readEntityById(
        meta.projectRoot,
        "decision",
        id,
      )!;
      const data: FrontmatterData = withLinks(
        {
          id,
          type: "decision",
          title: input.title,
          status,
          doc: defaultPath,
          verify: input.verify ?? null,
          notes: input.notes ?? null,
          created_at:
            (existingDefault.data.created_at as string) ?? nowIso(),
          updated_at: nowIso(),
        },
        input.links,
      );
      const body = `# ${input.title}\n\n`;
      const file = writeEntityFile(
        meta.projectRoot,
        defaultPath,
        data,
        body,
      );
      if (meta.db) {
        addDecisionDb(meta.db, {
          ...input,
          doc: defaultPath,
        });
      }
      return file;
    }
    throw new Error(`Decision ${id} already exists. Use force=true to overwrite.`);
  }

  const data: FrontmatterData = withLinks(
    {
      id,
      type: "decision",
      title: input.title,
      status,
      doc: relativePath,
      verify: input.verify ?? null,
      notes: input.notes ?? null,
      created_at: nowIso(),
      updated_at: nowIso(),
    },
    input.links,
  );

  const body = `# ${input.title}\n\n`;
  const file = writeEntityFile(meta.projectRoot, relativePath, data, body);

  if (meta.db) {
    addDecisionDb(meta.db, {
      ...input,
      doc: relativePath,
    });
  }
  return file;
}

export type IntakeWriteInput = IntakeInput & {
  links?: string;
  stories?: string;
};

export function addIntakeMd(
  meta: MdWriteMeta,
  input: IntakeWriteInput,
): { file: EntityFile; id: string; numericId?: number } {
  const inputType = parseInputType(input.type);
  const lane = parseRiskLane(input.lane);
  ensureEntityDirs(meta.projectRoot);

  const id = nextNumericEntityId(meta.projectRoot, "intake", "IN-");
  const relativePath = entityRelativePath("intake", id);
  const storyIds = [
    ...(input.story ? [sanitizeEntityId(input.story)] : []),
    ...(parseLinksCsv(input.stories) ?? []).map(sanitizeEntityId),
  ].filter((value, index, all) => all.indexOf(value) === index);
  const links = [
    ...(parseLinksCsv(input.links) ?? []),
    ...storyIds,
  ].filter((value, index, all) => all.indexOf(value) === index);

  const data: FrontmatterData = {
      id,
      type: "intake",
      status: "pending",
      input_type: inputType,
      summary: input.summary,
      lane,
      flags: input.flags ?? null,
      docs: input.docs ?? null,
      story: input.story ? sanitizeEntityId(input.story) : null,
      stories: storyIds,
      notes: input.notes ?? null,
      created_at: nowIso(),
      updated_at: nowIso(),
      links,
    };

  const body = `# Intake ${id}\n\n${input.summary}\n`;
  const file = writeEntityFile(meta.projectRoot, relativePath, data, body);

  let numericId: number | undefined;
  if (meta.db) {
    numericId = addIntakeDb(meta.db, input).id;
    // stamp sqlite id into file for transition correlation
    data.sqlite_id = numericId;
    writeEntityFile(meta.projectRoot, relativePath, data, body);
  }
  return { file, id, numericId };
}

export type IntakeUpdateWriteInput = {
  id: string;
  status?: string;
  stories?: string;
  notes?: string;
};

export function updateIntakeMd(
  meta: MdWriteMeta,
  input: IntakeUpdateWriteInput,
): EntityFile {
  const id = sanitizeEntityId(input.id);
  ensureEntityDirs(meta.projectRoot);
  const file = readEntityById(meta.projectRoot, "intake", id);
  if (!file) {
    throw new Error(`Intake ${id} not found`);
  }

  const data: FrontmatterData = { ...file.data, id, type: "intake" };
  let changed = false;
  if (input.status !== undefined) {
    data.status = parseIntakeStatus(input.status);
    changed = true;
  }
  if (input.stories !== undefined) {
    const previousStories = asStringArray(data, "stories") ?? [];
    const stories = (parseLinksCsv(input.stories) ?? []).map(sanitizeEntityId);
    data.stories = stories;
    data.links = [
      ...(asStringArray(data, "links") ?? []).filter(
        (link) => !previousStories.includes(link),
      ),
      ...stories,
    ].filter((value, index, all) => all.indexOf(value) === index);
    changed = true;
  }
  if (input.notes !== undefined) {
    data.notes = input.notes;
    changed = true;
  }
  if (!changed) {
    throw new Error("intake update requires status, stories, or notes");
  }

  data.updated_at = nowIso();
  return writeEntityFile(meta.projectRoot, file.relativePath, data, file.body);
}

export function autoCompleteEligibleIntakes(
  projectRoot: string,
): EntityFile[] {
  const storyStatuses = new Map(
    listEntityFiles(projectRoot, "story").map((story) => [
      asString(story.data, "id") ?? "",
      asString(story.data, "status") ?? "",
    ]),
  );
  const completed: EntityFile[] = [];

  for (const intake of listEntityFiles(projectRoot, "intake")) {
    const status = asString(intake.data, "status");
    if (status !== undefined && status !== "pending") continue;

    const explicitStories = asStringArray(intake.data, "stories") ?? [];
    const legacyStory = asString(intake.data, "story");
    const stories = (explicitStories.length > 0
      ? explicitStories
      : legacyStory
        ? [legacyStory]
        : []
    ).filter((value, index, all) => all.indexOf(value) === index);
    if (stories.length === 0) continue;
    if (!stories.every((storyId) => storyStatuses.get(storyId) === "implemented")) {
      continue;
    }

    completed.push(
      updateIntakeMd(
        { projectRoot },
        { id: asString(intake.data, "id") ?? "", status: "completed" },
      ),
    );
  }

  return completed;
}

export type BacklogWriteInput = BacklogAddInput & { links?: string };

export function addBacklogMd(
  meta: MdWriteMeta,
  input: BacklogWriteInput,
): { file: EntityFile; id: string; numericId?: number } {
  const risk = input.risk ? parseRiskLane(input.risk) : null;
  ensureEntityDirs(meta.projectRoot);

  const id = nextNumericEntityId(meta.projectRoot, "backlog", "BL-");
  const relativePath = entityRelativePath("backlog", id);

  const data: FrontmatterData = withLinks(
    {
      id,
      type: "backlog",
      title: input.title,
      status: "proposed",
      risk,
      discovered_while: input.while ?? null,
      pain: input.pain ?? null,
      suggestion: input.suggestion ?? null,
      predicted: input.predicted ?? null,
      outcome: null,
      notes: input.notes ?? null,
      created_at: nowIso(),
      updated_at: nowIso(),
    },
    input.links,
  );

  const body = `# ${input.title}\n\n`;
  const file = writeEntityFile(meta.projectRoot, relativePath, data, body);

  let numericId: number | undefined;
  if (meta.db) {
    numericId = addBacklogDb(meta.db, input).id;
    data.sqlite_id = numericId;
    writeEntityFile(meta.projectRoot, relativePath, data, body);
  }
  return { file, id, numericId };
}

export function closeBacklogMd(
  meta: MdWriteMeta,
  input: BacklogCloseInput,
): EntityFile {
  ensureEntityDirs(meta.projectRoot);
  const rawId = input.id.trim();

  // resolve by BL-### id, or by sqlite_id / numeric basename
  let file =
    readEntityById(meta.projectRoot, "backlog", sanitizeIfSafe(rawId)) ??
    findBacklogBySqliteOrNumber(meta.projectRoot, rawId);

  if (!file) {
    throw new Error(`Backlog item ${rawId} not found`);
  }

  const status: BacklogStatus = input.status
    ? parseBacklogStatus(input.status)
    : "implemented";
  if (status !== "implemented" && status !== "rejected") {
    throw new Error(
      `backlog close status must be implemented or rejected (got ${status})`,
    );
  }

  const data: FrontmatterData = {
    ...file.data,
    type: "backlog",
    status,
    outcome: input.outcome ?? null,
    updated_at: nowIso(),
  };
  const written = writeEntityFile(
    meta.projectRoot,
    file.relativePath,
    data,
    file.body,
  );

  if (meta.db) {
    const sqliteId = data.sqlite_id;
    try {
      closeBacklogDb(meta.db, {
        id: sqliteId !== undefined && sqliteId !== null ? String(sqliteId) : rawId,
        status: input.status,
        outcome: input.outcome,
      });
    } catch {
      // best-effort dual-write
    }
  }
  return written;
}

function sanitizeIfSafe(id: string): string {
  try {
    return sanitizeEntityId(id);
  } catch {
    return id;
  }
}

function findBacklogBySqliteOrNumber(
  projectRoot: string,
  rawId: string,
): EntityFile | null {
  const files = listEntityFiles(projectRoot, "backlog");
  const asNum = Number(rawId);
  for (const f of files) {
    if (String(f.data.sqlite_id) === rawId) return f;
    if (Number.isFinite(asNum) && Number(f.data.sqlite_id) === asNum) return f;
    if (String(f.data.id) === rawId) return f;
  }
  return null;
}
