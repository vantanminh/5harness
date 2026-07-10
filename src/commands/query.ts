import {
  queryBacklogMd,
  queryDecisionsMd,
  queryIntakesMd,
  queryMatrixMd,
  queryStatsMd,
  queryStoriesMd,
} from "../application/md-query.js";
import { queryTracesMd } from "../application/local-traces.js";
import { listTools } from "../domain/tools.js";
import { listAllTools } from "../application/tool-registry.js";
import {
  resolveTargetFromOptions,
  type TargetOptions,
} from "../infrastructure/context.js";
import { formatTable } from "../infrastructure/table.js";

export type QueryCliOptions = TargetOptions & {
  numeric?: boolean;
  open?: boolean;
  closed?: boolean;
  capability?: string;
  status?: string;
};

function formatTools(options: QueryCliOptions): string {
  const builtins = listTools({
    capability: options.capability,
    status: options.status,
  });
  const { targetDir } = resolveTargetFromOptions(options);
  const registered = listAllTools(targetDir);

  // Apply filters to registered tools too
  const filteredRegistered = registered.filter((t) => {
    if (options.capability && t.capability !== options.capability) return false;
    if (options.status && t.status !== options.status) return false;
    return true;
  });

  const combined = [
    ...builtins.map((t) => ({
      name: t.name,
      kind: t.kind,
      capability: t.capability,
      responsibility: t.responsibility,
      status: t.status,
      source: t.source,
    })),
    ...filteredRegistered.map((t) => ({
      name: t.name,
      kind: t.kind,
      capability: t.capability ?? "",
      responsibility: t.responsibility,
      status: t.status ?? "unknown",
      source: "registered",
    })),
  ];

  return formatTable(combined, [
    "name",
    "kind",
    "capability",
    "responsibility",
    "status",
    "source",
  ]);
}

/**
 * Query operational views from markdown entities (US-008).
 * Does not require project harness.db.
 */
export function executeQuery(
  view: string,
  options: QueryCliOptions = {},
): void {
  if (view === "tools") {
    console.log(formatTools(options));
    return;
  }

  const { targetDir } = resolveTargetFromOptions(options);

  let output: string;
  switch (view) {
    case "matrix":
      output = queryMatrixMd(targetDir, Boolean(options.numeric));
      break;
    case "stats":
      output = queryStatsMd(targetDir);
      break;
    case "intakes":
      output = queryIntakesMd(targetDir);
      break;
    case "decisions":
      output = queryDecisionsMd(targetDir);
      break;
    case "stories":
      output = queryStoriesMd(targetDir);
      break;
    case "backlog": {
      const filter =
        options.open && !options.closed
          ? "open"
          : options.closed && !options.open
            ? "closed"
            : "all";
      output = queryBacklogMd(targetDir, filter);
      break;
    }
    case "traces":
      output = queryTracesMd(targetDir);
      break;
    default:
      throw new Error(
        `Unknown query view "${view}". Use matrix | stats | intakes | decisions | backlog | stories | traces | tools`,
      );
  }
  console.log(output);
}
