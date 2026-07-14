import { buildCatalog, type CatalogEntry } from "./catalog.js";
import { asString } from "../domain/frontmatter.js";
import { readProjectLink } from "../infrastructure/project-link.js";

export type NextItem = {
  id: string;
  type: string;
  title: string;
  status: string;
  reason: string;
};

export type NextListOptions = {
  limit: number;
};

const DEFAULT_LIMIT = 10;

export function buildNextList(
  projectRoot: string,
  options: NextListOptions = { limit: DEFAULT_LIMIT },
): NextItem[] {
  const catalog = buildCatalog(projectRoot);
  const items: NextItem[] = [];

  // Tier 1: in_progress stories (continue what was started)
  const inProgress = catalog.byType.story.filter(
    (s) => s.status === "in_progress",
  );
  inProgress.sort((a, b) => a.id.localeCompare(b.id));
  for (const s of inProgress) {
    items.push({
      id: s.id,
      type: "story",
      title: s.title,
      status: s.status,
      reason: "in progress — continue work",
    });
  }

  // Tier 2: open reports are the backend's cross-project work queue.
  let isBackend = false;
  try {
    isBackend = readProjectLink(projectRoot).role === "backend";
  } catch {
    // Uninitialized projects retain the pre-Project Link ordering.
  }
  if (isBackend) {
    const openReports = catalog.byType.report.filter(
      (report) => report.status === "open",
    );
    openReports.sort((a, b) => a.id.localeCompare(b.id));
    for (const report of openReports) {
      items.push({
        id: report.id,
        type: "report",
        title: report.title,
        status: report.status,
        reason: "open report — review before planned work",
      });
    }
  }

  // Tier 3: planned stories
  const planned = catalog.byType.story.filter(
    (s) => s.status === "planned",
  );
  planned.sort((a, b) => a.id.localeCompare(b.id));
  for (const s of planned) {
    items.push({
      id: s.id,
      type: "story",
      title: s.title,
      status: s.status,
      reason: "planned — ready to start",
    });
  }

  // Tier 4: open intakes (recent first)
  const openIntakes = [...catalog.byType.intake]
    .sort((a, b) => b.id.localeCompare(a.id));
  for (const i of openIntakes) {
    items.push({
      id: i.id,
      type: "intake",
      title: i.title,
      status: asString(i.data, "input_type") ?? "",
      reason: "pending intake",
    });
  }

  // Tier 5: open backlog (proposed/accepted)
  const openBacklogStatuses = new Set(["proposed", "accepted"]);
  const openBacklog = catalog.byType.backlog.filter((b) =>
    openBacklogStatuses.has(b.status),
  );
  openBacklog.sort((a, b) => a.id.localeCompare(b.id));
  for (const b of openBacklog) {
    items.push({
      id: b.id,
      type: "backlog",
      title: b.title,
      status: b.status,
      reason: "open backlog item",
    });
  }

  return items.slice(0, options.limit);
}

export function formatNextList(items: NextItem[], json: boolean): string {
  if (json) {
    return JSON.stringify(items, null, 2);
  }

  if (items.length === 0) {
    return "No pending work items found.";
  }

  const lines = items.map((item) => {
    return `${item.id}  [${item.type}]  ${item.title}  (${item.reason})`;
  });
  return lines.join("\n");
}
