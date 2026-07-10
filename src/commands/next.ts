import {
  resolveTargetFromOptions,
  type TargetOptions,
} from "../infrastructure/context.js";
import { buildNextList, formatNextList } from "../application/next.js";

export type NextCliOptions = TargetOptions & {
  json?: boolean;
  limit?: string;
};

export function executeNext(options: NextCliOptions = {}): void {
  const { targetDir } = resolveTargetFromOptions(options);
  const limit = options.limit ? Number(options.limit) : 10;
  if (!Number.isFinite(limit) || limit < 1) {
    throw new Error(`Invalid --limit "${options.limit}"`);
  }
  const items = buildNextList(targetDir, { limit });
  const output = formatNextList(items, Boolean(options.json));
  console.log(output);
}
