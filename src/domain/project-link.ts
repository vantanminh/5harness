import { extractHarnessBlock, HARNESS_BEGIN } from "./upgrade.js";

export const PROJECT_ROLES = [
  "frontend",
  "backend",
  "mobile",
  "service",
  "shared",
  "other",
] as const;

export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const MAX_PROJECT_STACK_TAGS = 4;
export const MAX_PROJECT_STACK_TAG_LENGTH = 32;

const ROLE_MARKER_RE =
  /<!--\s*harness-project-role:\s*([^\s-][^\r\n]*?)\s*-->/;
const STACK_MARKER_RE =
  /<!--\s*harness-project-stack:\s*([^\r\n]*?)\s*-->/;
const PROJECT_LINK_MARKER_LINE_RE =
  /^[ \t]*<!--\s*(?:harness-project-role|harness-project-stack|harness-peer)\s*:[^\r\n]*-->[ \t]*$/gm;
const ROLE_MARKER_LINE_RE =
  /^[ \t]*<!--\s*harness-project-role\s*:[^\r\n]*-->[ \t]*(?:\r?\n)?/gm;
const STACK_MARKER_LINE_RE =
  /^[ \t]*<!--\s*harness-project-stack\s*:[^\r\n]*-->[ \t]*(?:\r?\n)?/gm;
const STACK_TOKEN_RE = /^[a-z0-9_-]+$/;

export type ProjectRoleConfig = {
  role: ProjectRole | null;
  stack: string[];
};

export function parseProjectRole(raw: string): ProjectRole {
  const normalized = raw.trim().toLowerCase();
  if ((PROJECT_ROLES as readonly string[]).includes(normalized)) {
    return normalized as ProjectRole;
  }
  throw new Error(
    `Invalid project role "${raw}". Use ${PROJECT_ROLES.join(" | ")}`,
  );
}

export function parseProjectStack(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === "") return [];

  const tags = raw.split(",").map((tag) => tag.trim());
  if (tags.some((tag) => !tag)) {
    throw new Error("Invalid project stack: tags must not be empty.");
  }
  if (tags.length > MAX_PROJECT_STACK_TAGS) {
    throw new Error(
      `Invalid project stack: use at most ${MAX_PROJECT_STACK_TAGS} tags.`,
    );
  }
  for (const tag of tags) {
    if (!STACK_TOKEN_RE.test(tag)) {
      throw new Error(
        `Invalid project stack tag "${tag}". Use lowercase letters, numbers, _ or -.`,
      );
    }
    if (tag.length > MAX_PROJECT_STACK_TAG_LENGTH) {
      throw new Error(
        `Invalid project stack tag "${tag}": use at most ${MAX_PROJECT_STACK_TAG_LENGTH} characters.`,
      );
    }
  }
  if (new Set(tags).size !== tags.length) {
    throw new Error("Invalid project stack: duplicate tags are not allowed.");
  }
  return tags;
}

export function extractProjectRoleConfig(agentsText: string): ProjectRoleConfig {
  const extracted = extractHarnessBlock(agentsText);
  if (!extracted) return { role: null, stack: [] };

  const roleRaw = ROLE_MARKER_RE.exec(extracted.block)?.[1];
  const stackRaw = STACK_MARKER_RE.exec(extracted.block)?.[1];
  return {
    role: roleRaw ? parseProjectRole(roleRaw) : null,
    stack: parseProjectStack(stackRaw),
  };
}

function insertMetadataLines(block: string, lines: string[]): string {
  if (lines.length === 0) return block;
  const newline = block.includes("\r\n") ? "\r\n" : "\n";
  const markerText = lines.join(newline);
  const projectIdPattern = /^(<!--\s*harness-project-id:[^\r\n]*-->)/m;
  const versionPattern = /^(<!--\s*harness-version:[^\r\n]*-->)/m;

  if (projectIdPattern.test(block)) {
    return block.replace(projectIdPattern, `$1${newline}${markerText}`);
  }
  if (versionPattern.test(block)) {
    return block.replace(versionPattern, `$1${newline}${markerText}`);
  }
  return block.replace(HARNESS_BEGIN, `${HARNESS_BEGIN}${newline}${markerText}`);
}

export function setProjectRoleMarkers(
  agentsText: string,
  role: ProjectRole,
  stack: readonly string[],
): string {
  const extracted = extractHarnessBlock(agentsText);
  if (!extracted) {
    throw new Error(
      "AGENTS.md has no harness-managed block. Run `harness init --force` first.",
    );
  }

  const parsedStack = parseProjectStack(stack.join(","));
  const stripped = extracted.block
    .replace(ROLE_MARKER_LINE_RE, "")
    .replace(STACK_MARKER_LINE_RE, "");
  const lines = [`<!-- harness-project-role: ${role} -->`];
  if (parsedStack.length > 0) {
    lines.push(`<!-- harness-project-stack: ${parsedStack.join(",")} -->`);
  }
  const updatedBlock = insertMetadataLines(stripped, lines);
  return extracted.before + updatedBlock + extracted.after;
}

/** Preserve opt-in Project Link metadata while the managed template is replaced. */
export function preserveProjectLinkMarkers(
  templateBlock: string,
  currentAgentsText: string,
): string {
  const current = extractHarnessBlock(currentAgentsText);
  if (!current) return templateBlock;
  const markerLines = current.block.match(PROJECT_LINK_MARKER_LINE_RE) ?? [];
  if (markerLines.length === 0) return templateBlock;

  const stripped = templateBlock
    .replace(ROLE_MARKER_LINE_RE, "")
    .replace(STACK_MARKER_LINE_RE, "")
    .replace(
      /^[ \t]*<!--\s*harness-peer\s*:[^\r\n]*-->[ \t]*(?:\r?\n)?/gm,
      "",
    );
  return insertMetadataLines(
    stripped,
    markerLines.map((line) => line.trim()),
  );
}
