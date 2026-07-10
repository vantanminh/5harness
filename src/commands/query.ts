import {
  queryBacklog,
  queryDecisions,
  queryIntakes,
  queryMatrix,
  queryStats,
  queryStories,
} from "../application/durable.js";
import { withHarnessDb, type TargetOptions } from "../infrastructure/context.js";

export type QueryCliOptions = TargetOptions & {
  numeric?: boolean;
  open?: boolean;
  closed?: boolean;
};

export function executeQuery(
  view: string,
  options: QueryCliOptions = {},
): void {
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
      default:
        throw new Error(
          `Unknown query view "${view}". Use matrix | stats | intakes | decisions | backlog | stories`,
        );
    }
  });
  console.log(output);
}
