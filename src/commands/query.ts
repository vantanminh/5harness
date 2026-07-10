import {
  queryBacklog,
  queryDecisions,
  queryIntakes,
  queryMatrix,
  queryStats,
  queryStories,
} from "../application/durable.js";
import { queryTraces } from "../application/quality.js";
import { listTools } from "../domain/tools.js";
import { formatTable } from "../infrastructure/table.js";
import { withHarnessDb, type TargetOptions } from "../infrastructure/context.js";

export type QueryCliOptions = TargetOptions & {
  numeric?: boolean;
  open?: boolean;
  closed?: boolean;
  capability?: string;
  status?: string;
};

function formatTools(options: QueryCliOptions): string {
  const tools = listTools({
    capability: options.capability,
    status: options.status,
  });
  return formatTable(
    tools.map((t) => ({
      name: t.name,
      kind: t.kind,
      capability: t.capability,
      responsibility: t.responsibility,
      status: t.status,
      source: t.source,
    })),
    [
      "name",
      "kind",
      "capability",
      "responsibility",
      "status",
      "source",
    ],
  );
}

export function executeQuery(
  view: string,
  options: QueryCliOptions = {},
): void {
  // tools registry is compiled — no DB required
  if (view === "tools") {
    console.log(formatTools(options));
    return;
  }

  const output = withHarnessDb(options, (db) => {
    switch (view) {
      case "matrix":
        return queryMatrix(db, Boolean(options.numeric));
      case "stats":
        return queryStats(db);
      case "intakes":
        return queryIntakes(db);
      case "decisions":
        return queryDecisions(db);
      case "stories":
        return queryStories(db);
      case "backlog": {
        const filter =
          options.open && !options.closed
            ? "open"
            : options.closed && !options.open
              ? "closed"
              : "all";
        return queryBacklog(db, filter);
      }
      case "traces":
        return queryTraces(db);
      default:
        throw new Error(
          `Unknown query view "${view}". Use matrix | stats | intakes | decisions | backlog | stories | traces | tools`,
        );
    }
  });
  console.log(output);
}
