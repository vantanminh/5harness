import { buildCatalog } from "./catalog.js";
import { extractRepoVersion, compareVersions } from "../domain/upgrade.js";
import { listLocalTraces } from "./local-traces.js";
import { runAudit } from "./quality.js";
import { indexJsonPath, hasMarkdownStore } from "./index-store.js";
import type { ProjectIndex } from "./index-store.js";
import { VERSION } from "../version.js";
import type { ProjectRole } from "../domain/project-link.js";
import { readProjectLink } from "../infrastructure/project-link.js";
import fs from "node:fs";
import path from "node:path";

export type StatusSnapshot = {
  cliVersion: string;
  projectRoot: string;
  stories: { total: number; openCount: number; inProgressCount: number };
  intakes: { total: number; recent: Array<{ id: string; summary: string; created: string }> };
  backlog: { total: number; openCount: number };
  decisions: { total: number };
  traces: { total: number };
  projectLink: {
    role: ProjectRole | null;
    stack: string[];
    peerCount: number;
    openReportCount: number;
  };
  version: { cli: string; repo: string | null; mismatch: boolean };
  index: { present: boolean; age: string | null; stale: boolean };
  audit: { lastScore: number | null };
};

function readIndexOrNull(projectRoot: string): ProjectIndex | null {
  const p = indexJsonPath(projectRoot);
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as ProjectIndex;
  } catch {
    return null;
  }
}

export function buildStatus(projectRoot: string): StatusSnapshot {
  const catalog = buildCatalog(projectRoot);
  const stories = catalog.byType.story;
  const intakes = catalog.byType.intake;
  const backlog = catalog.byType.backlog;
  const decisions = catalog.byType.decision;
  const reports = catalog.byType.report;
  const traces = listLocalTraces(projectRoot);

  const openStoryStatuses = new Set(["planned", "in_progress"]);
  const openStories = stories.filter((s) => openStoryStatuses.has(s.status));
  const inProgressStories = stories.filter((s) => s.status === "in_progress");

  const openBacklogStatuses = new Set(["proposed", "accepted"]);
  const openBacklog = backlog.filter((b) => openBacklogStatuses.has(b.status));

  let projectLink: StatusSnapshot["projectLink"] = {
    role: null,
    stack: [],
    peerCount: 0,
    openReportCount: reports.filter((report) => report.status === "open").length,
  };
  try {
    const config = readProjectLink(projectRoot);
    projectLink = {
      ...projectLink,
      role: config.role,
      stack: config.stack,
      peerCount: config.peers.length,
    };
  } catch {
    // Status remains useful for uninitialized or partially scaffolded projects.
  }

  // Recent intakes: last 5 by id desc
  const recentIntakes = [...intakes]
    .sort((a, b) => b.id.localeCompare(a.id))
    .slice(0, 5)
    .map((e) => {
      const created = `${e.data.created_at ?? ""}`;
      return {
        id: e.id,
        summary: e.title,
        created: typeof created === "string" ? created : "",
      };
    });

  // Version check
  const agentsPath = path.join(projectRoot, "AGENTS.md");
  let repoVersion: string | null = null;
  let versionMismatch = false;
  if (fs.existsSync(agentsPath)) {
    const text = fs.readFileSync(agentsPath, "utf8");
    repoVersion = extractRepoVersion(text);
    if (repoVersion && compareVersions(VERSION, repoVersion) !== 0) {
      versionMismatch = true;
    }
  }

  // Index
  const index = readIndexOrNull(projectRoot);
  const idxAge = index
    ? `${Math.round((Date.now() - new Date(index.built_at).getTime()) / 1000)}s ago`
    : null;

  // Simple stale detection
  let idxStale = false;
  if (index) {
    try {
      const idxTime = new Date(index.built_at).getTime();
      for (const e of catalog.entries) {
        if (e.mtimeMs > idxTime) {
          idxStale = true;
          break;
        }
      }
    } catch { /* ignore */ }
  }

  // Last audit score from entropy
  let lastScore: number | null = null;
  try {
    lastScore = runAudit(projectRoot).entropyScore;
  } catch { /* audit may fail on incomplete projects */ }

  return {
    cliVersion: VERSION,
    projectRoot,
    stories: {
      total: stories.length,
      openCount: openStories.length,
      inProgressCount: inProgressStories.length,
    },
    intakes: {
      total: intakes.length,
      recent: recentIntakes,
    },
    backlog: {
      total: backlog.length,
      openCount: openBacklog.length,
    },
    decisions: { total: decisions.length },
    traces: { total: traces.length },
    projectLink,
    version: {
      cli: VERSION,
      repo: repoVersion,
      mismatch: versionMismatch,
    },
    index: {
      present: index !== null,
      age: idxAge,
      stale: idxStale,
    },
    audit: { lastScore },
  };
}

export function formatStatus(snapshot: StatusSnapshot, json: boolean): string {
  if (json) {
    return JSON.stringify(snapshot, null, 2);
  }

  const s = snapshot;
  const lines = [
    `harness status v${s.cliVersion}`,
    `project: ${s.projectRoot}`,
    "",
    "--- Stories ---",
    `  total: ${s.stories.total}`,
    `  open (planned + in_progress): ${s.stories.openCount}`,
    `  in_progress: ${s.stories.inProgressCount}`,
    "",
    "--- Intakes ---",
    `  total: ${s.intakes.total}`,
  ];
  if (s.intakes.recent.length > 0) {
    lines.push("  recent:");
    for (const ri of s.intakes.recent) {
      lines.push(`    ${ri.id}: ${ri.summary}  (${ri.created.slice(0, 10)})`);
    }
  }
  lines.push(
    "",
    "--- Backlog ---",
    `  total: ${s.backlog.total}`,
    `  open: ${s.backlog.openCount}`,
    "",
    "--- Decisions ---",
    `  total: ${s.decisions.total}`,
    "",
    "--- Traces ---",
    `  total: ${s.traces.total}`,
    "",
    "--- Project Link ---",
    `  role: ${s.projectLink.role ?? "unset"}`,
    `  stack: ${s.projectLink.stack.length > 0 ? s.projectLink.stack.join(", ") : "(none)"}`,
    `  peers: ${s.projectLink.peerCount}`,
    `  open reports: ${s.projectLink.openReportCount}`,
    "",
    "--- Version ---",
    `  CLI: ${s.version.cli}`,
    `  repo (AGENTS.md): ${s.version.repo ?? "unknown"}`,
    `  mismatch: ${s.version.mismatch ? "yes" : "no"}`,
    "",
    "--- Index ---",
    `  present: ${s.index.present ? "yes" : "no"}`,
    `  age: ${s.index.age ?? "N/A"}`,
    `  stale: ${s.index.stale ? "yes" : "no"}`,
  );
  if (s.audit.lastScore !== null) {
    lines.push("", "--- Audit ---", `  last entropy score: ${s.audit.lastScore}/100`);
  }
  return lines.join("\n");
}
