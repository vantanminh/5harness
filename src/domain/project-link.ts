import {
  extractHarnessBlock,
  HARNESS_BEGIN,
  HARNESS_END,
} from "./upgrade.js";
import { parseProjectId } from "./project-id.js";

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
const PEER_MARKER_RE = /<!--\s*harness-peer:\s*([^\r\n]*?)\s*-->/g;
const PEER_MARKER_LINE_RE =
  /^[ \t]*<!--\s*harness-peer\s*:[^\r\n]*-->[ \t]*(?:\r?\n)?/gm;
const STACK_TOKEN_RE = /^[a-z0-9_-]+$/;

export type ProjectRoleConfig = {
  role: ProjectRole | null;
  stack: string[];
};

export type ProjectPeer = {
  id: string;
  role: ProjectRole;
};

export type ProjectLinkConfig = ProjectRoleConfig & {
  peers: ProjectPeer[];
};

export const PROJECT_LINK_WORKFLOW_BEGIN =
  "<!-- HARNESS:PROJECT-LINK:BEGIN -->";
export const PROJECT_LINK_WORKFLOW_END =
  "<!-- HARNESS:PROJECT-LINK:END -->";

const PROJECT_LINK_WORKFLOW_RE =
  /^[ \t]*<!-- HARNESS:PROJECT-LINK:BEGIN -->[\s\S]*?^[ \t]*<!-- HARNESS:PROJECT-LINK:END -->[ \t]*(?:\r?\n){0,2}/m;

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

function parseProjectPeerMarker(raw: string): ProjectPeer {
  const fields = new Map<string, string>();
  for (const segment of raw.split(";")) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0 || separator === trimmed.length - 1) {
      throw new Error(`Invalid harness peer marker field "${trimmed}".`);
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (key !== "id" && key !== "role") {
      throw new Error(`Invalid harness peer marker key "${key}".`);
    }
    if (fields.has(key)) {
      throw new Error(`Duplicate harness peer marker key "${key}".`);
    }
    fields.set(key, value);
  }

  const id = fields.get("id");
  const role = fields.get("role");
  if (!id || !role) {
    throw new Error("Invalid harness peer marker: id and role are required.");
  }
  return { id: parseProjectId(id), role: parseProjectRole(role) };
}

export function extractProjectPeers(agentsText: string): ProjectPeer[] {
  const extracted = extractHarnessBlock(agentsText);
  if (!extracted) return [];

  const peers: ProjectPeer[] = [];
  const ids = new Set<string>();
  for (const match of extracted.block.matchAll(PEER_MARKER_RE)) {
    const peer = parseProjectPeerMarker(match[1] ?? "");
    if (ids.has(peer.id)) {
      throw new Error(`Duplicate harness peer marker for project ${peer.id}.`);
    }
    ids.add(peer.id);
    peers.push(peer);
  }
  return peers;
}

export function extractProjectLinkConfig(agentsText: string): ProjectLinkConfig {
  return {
    ...extractProjectRoleConfig(agentsText),
    peers: extractProjectPeers(agentsText),
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

function insertPeerLines(block: string, lines: string[]): string {
  if (lines.length === 0) return block;
  const newline = block.includes("\r\n") ? "\r\n" : "\n";
  const markerText = lines.join(newline);
  const anchors = [
    /^[ \t]*<!--\s*harness-project-stack:[^\r\n]*-->[ \t]*$/m,
    /^[ \t]*<!--\s*harness-project-role:[^\r\n]*-->[ \t]*$/m,
    /^[ \t]*<!--\s*harness-project-id:[^\r\n]*-->[ \t]*$/m,
    /^[ \t]*<!--\s*harness-version:[^\r\n]*-->[ \t]*$/m,
  ];
  for (const anchor of anchors) {
    if (anchor.test(block)) {
      return block.replace(anchor, `$&${newline}${markerText}`);
    }
  }
  return block.replace(HARNESS_BEGIN, `${HARNESS_BEGIN}${newline}${markerText}`);
}

function withoutProjectLinkWorkflow(block: string): string {
  const beginCount = block.split(PROJECT_LINK_WORKFLOW_BEGIN).length - 1;
  const endCount = block.split(PROJECT_LINK_WORKFLOW_END).length - 1;
  const ordered =
    beginCount === 1 &&
    endCount === 1 &&
    block.indexOf(PROJECT_LINK_WORKFLOW_BEGIN) <
      block.indexOf(PROJECT_LINK_WORKFLOW_END);
  const removable = PROJECT_LINK_WORKFLOW_RE.test(block);
  if (
    (beginCount !== 0 || endCount !== 0) &&
    (!ordered || !removable)
  ) {
    throw new Error(
      "AGENTS.md has an invalid or incomplete managed Project Link workflow section. Run `harness upgrade` after repairing the managed block.",
    );
  }
  return block.replace(PROJECT_LINK_WORKFLOW_RE, "");
}

function projectLinkWorkflowLines(config: ProjectLinkConfig): string[] {
  const lines = [
    PROJECT_LINK_WORKFLOW_BEGIN,
    "### Project Link workflow",
    "",
    `This repository opted into Project Link${config.role ? ` as \`${config.role}\`` : ""}.`,
    "Resolve only configured peers (`harness project peer list`); never traverse",
    "peer-of-peer links or treat a filesystem path as a peer capability.",
    "",
    "- Use the `harness peer` read commands for bounded peer context.",
    "- Cross-project writes are limited to sanitized `report` entities; never",
    "  include credentials, tokens, secrets, or unnecessary personal data.",
    "- Create and update reports only through `harness report` commands; never",
    "  hand-edit `docs/reports/` operational entities.",
  ];
  if (config.role === "frontend") {
    lines.push(
      "- For API/backend contracts, prefer peer tools over inventing schemas; file",
      "  mismatches with `harness report add --to backend --summary \"...\"`.",
    );
  }
  if (config.role === "backend") {
    lines.push(
      "- Before fixing frontend/peer issues, run `harness report list --status open`;",
      "  acknowledge with `acked`, then record `fixed` plus a resolution.",
    );
  }
  lines.push(PROJECT_LINK_WORKFLOW_END);
  return lines;
}

/** Refresh the conditional agent workflow from durable role/peer markers. */
export function syncProjectLinkWorkflow(agentsText: string): string {
  const extracted = extractHarnessBlock(agentsText);
  if (!extracted) {
    throw new Error(
      "AGENTS.md has no harness-managed block. Run `harness init --force` first.",
    );
  }

  const config = extractProjectLinkConfig(agentsText);
  const stripped = withoutProjectLinkWorkflow(extracted.block);
  if (!config.role && config.peers.length === 0) {
    return extracted.before + stripped + extracted.after;
  }

  const newline = stripped.includes("\r\n") ? "\r\n" : "\n";
  const section = projectLinkWorkflowLines(config).join(newline);
  const beforeWork = /^### Before work[^\r\n]*$/m;
  let updatedBlock: string;
  if (beforeWork.test(stripped)) {
    updatedBlock = stripped.replace(
      beforeWork,
      `${section}${newline}${newline}$&`,
    );
  } else {
    const endAt = stripped.indexOf(HARNESS_END);
    const beforeEnd = stripped
      .slice(0, endAt)
      .replace(/[ \t]*(?:\r?\n)*$/, "");
    updatedBlock =
      beforeEnd +
      newline +
      newline +
      section +
      newline +
      stripped.slice(endAt);
  }
  return extracted.before + updatedBlock + extracted.after;
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
  return syncProjectLinkWorkflow(
    extracted.before + updatedBlock + extracted.after,
  );
}

export function setProjectPeerMarkers(
  agentsText: string,
  peers: readonly ProjectPeer[],
): string {
  const extracted = extractHarnessBlock(agentsText);
  if (!extracted) {
    throw new Error(
      "AGENTS.md has no harness-managed block. Run `harness init --force` first.",
    );
  }

  const normalized = peers.map((peer) => ({
    id: parseProjectId(peer.id),
    role: parseProjectRole(peer.role),
  }));
  if (new Set(normalized.map((peer) => peer.id)).size !== normalized.length) {
    throw new Error("Duplicate harness peer project ids are not allowed.");
  }
  const stripped = extracted.block.replace(PEER_MARKER_LINE_RE, "");
  const lines = normalized.map(
    (peer) => `<!-- harness-peer: id=${peer.id};role=${peer.role} -->`,
  );
  const updatedBlock = insertPeerLines(stripped, lines);
  return syncProjectLinkWorkflow(
    extracted.before + updatedBlock + extracted.after,
  );
}

export function upsertProjectPeerMarker(
  agentsText: string,
  peer: ProjectPeer,
): string {
  const id = parseProjectId(peer.id);
  const peers = extractProjectPeers(agentsText).filter(
    (existing) => existing.id !== id,
  );
  peers.push({ id, role: parseProjectRole(peer.role) });
  return setProjectPeerMarkers(agentsText, peers);
}

export function removeProjectPeerMarker(
  agentsText: string,
  projectId: string,
): string {
  const id = parseProjectId(projectId);
  const peers = extractProjectPeers(agentsText);
  if (!peers.some((peer) => peer.id === id)) return agentsText;
  return setProjectPeerMarkers(
    agentsText,
    peers.filter((peer) => peer.id !== id),
  );
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
    .replace(PEER_MARKER_LINE_RE, "");
  return syncProjectLinkWorkflow(
    insertMetadataLines(
      stripped,
      markerLines.map((line) => line.trim()),
    ),
  );
}
