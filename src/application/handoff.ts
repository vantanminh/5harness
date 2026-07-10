import { buildStatus, type StatusSnapshot } from "./status.js";
import { listLocalTraces, type LocalTrace } from "./local-traces.js";
import { listWorklog, type WorklogEntry } from "./worklog.js";
import { buildCatalog } from "./catalog.js";
import { buildProjectIndex } from "./index-store.js";
import { readEntityFile } from "../infrastructure/entities.js";
import { resolveCatalogEntry } from "./catalog.js";

export type HandoffSummary = {
  status: {
    openStories: number;
    inProgressStories: number;
    openBacklog: number;
  };
  recentTraces: Array<{
    id: number;
    summary: string;
    outcome: string | null;
    story: string | null;
  }>;
  recentWorklog: Array<{
    id: number;
    story: string;
    summary: string;
    pr: string | null;
    commit: string | null;
  }>;
  storyDetail?: {
    id: string;
    title: string;
    status: string;
    body: string;
  };
  indexAge: string | null;
  nextSteps: string[];
};

export function buildHandoff(
  projectRoot: string,
  storyId?: string,
): HandoffSummary {
  const snapshot = buildStatus(projectRoot);
  const traces = listLocalTraces(projectRoot);
  const worklogs = listWorklog(projectRoot);

  const MAX_RECENT = 5;
  const recentTraces = traces
    .sort((a, b) => b.id - a.id)
    .slice(0, MAX_RECENT)
    .map((t) => ({
      id: t.id,
      summary: t.task_summary,
      outcome: t.outcome,
      story: t.story_id,
    }));

  const recentWorklog = worklogs
    .sort((a, b) => b.id - a.id)
    .slice(0, MAX_RECENT)
    .map((w) => ({
      id: w.id,
      story: w.story_id,
      summary: w.summary,
      pr: w.pr,
      commit: w.commit,
    }));

  let storyDetail: HandoffSummary["storyDetail"] | undefined;
  if (storyId) {
    const catalog = buildCatalog(projectRoot);
    const entry = resolveCatalogEntry(catalog, storyId);
    if (entry) {
      const file = readEntityFile(projectRoot, entry.path);
      storyDetail = {
        id: entry.id,
        title: entry.title,
        status: entry.status,
        body: file?.body ?? "",
      };
    }
  }

  // Derive next steps from open stories/intakes
  const nextSteps: string[] = [];
  if (snapshot.stories.inProgressCount > 0) {
    nextSteps.push(
      `${snapshot.stories.inProgressCount} story/stories in progress`,
    );
  }
  if (snapshot.stories.openCount > snapshot.stories.inProgressCount) {
    nextSteps.push(
      `${snapshot.stories.openCount - snapshot.stories.inProgressCount} planned story/stories not started`,
    );
  }
  if (snapshot.backlog.openCount > 0) {
    nextSteps.push(`${snapshot.backlog.openCount} open backlog item(s)`);
  }
  if (snapshot.index.stale) {
    nextSteps.push("Index is stale — consider running `harness reindex`");
  }

  return {
    status: {
      openStories: snapshot.stories.openCount,
      inProgressStories: snapshot.stories.inProgressCount,
      openBacklog: snapshot.backlog.openCount,
    },
    recentTraces,
    recentWorklog,
    storyDetail,
    indexAge: snapshot.index.age,
    nextSteps: nextSteps.length > 0 ? nextSteps : ["No open items."],
  };
}

export function formatHandoff(
  summary: HandoffSummary,
  json: boolean,
): string {
  if (json) {
    return JSON.stringify(summary, null, 2);
  }

  const lines: string[] = [
    "== Session Handoff ==",
    "",
    "--- Status ---",
    `  Open stories: ${summary.status.openStories} (${summary.status.inProgressStories} in progress)`,
    `  Open backlog: ${summary.status.openBacklog}`,
    "",
  ];

  if (summary.storyDetail) {
    const sd = summary.storyDetail;
    lines.push(
      "--- Focus Story ---",
      `  ${sd.id}: ${sd.title}`,
      `  Status: ${sd.status}`,
    );
    if (sd.body) {
      const preview = sd.body.slice(0, 200);
      lines.push(`  Body preview: ${preview}${sd.body.length > 200 ? "..." : ""}`);
    }
    lines.push("");
  }

  lines.push("--- Recent Traces ---");
  if (summary.recentTraces.length === 0) lines.push("  (none)");
  for (const t of summary.recentTraces) {
    lines.push(
      `  [${t.id}] ${t.outcome ?? "N/A"} — ${t.summary.slice(0, 80)}${t.story ? ` (${t.story})` : ""}`,
    );
  }

  lines.push("", "--- Recent Worklog ---");
  if (summary.recentWorklog.length === 0) lines.push("  (none)");
  for (const w of summary.recentWorklog) {
    const refs: string[] = [];
    if (w.pr) refs.push(`PR: ${w.pr}`);
    if (w.commit) refs.push(`commit: ${w.commit}`);
    const refStr = refs.length > 0 ? ` [${refs.join(", ")}]` : "";
    lines.push(`  [${w.id}] ${w.story}: ${w.summary.slice(0, 80)}${refStr}`);
  }

  lines.push(
    "",
    "--- Next Steps ---",
    ...summary.nextSteps.map((s) => `  - ${s}`),
    "",
    `Index age: ${summary.indexAge ?? "N/A"}`,
  );

  return lines.join("\n");
}
