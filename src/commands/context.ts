import {
  resolveTargetFromOptions,
  type TargetOptions,
} from "../infrastructure/context.js";
import { buildContextPack, formatContextPack } from "../application/context-pack.js";

export type ContextCliOptions = TargetOptions & {
  json?: boolean;
  depth?: string;
  maxChars?: string;
};

export function executeContext(
  entityId: string,
  options: ContextCliOptions = {},
): void {
  if (!entityId?.trim()) {
    throw new Error("context requires an entity id");
  }
  const { targetDir } = resolveTargetFromOptions(options);
  const depth = options.depth ? Number(options.depth) : 0;
  if (depth !== 0 && depth !== 1) {
    throw new Error("--depth must be 0 or 1");
  }
  const maxChars = options.maxChars ? Number(options.maxChars) : 8000;
  if (!Number.isFinite(maxChars) || maxChars < 100) {
    throw new Error(`Invalid --max-chars "${options.maxChars}"`);
  }

  const pack = buildContextPack(targetDir, entityId.trim(), {
    depth: depth as 0 | 1,
    maxChars,
  });
  if (!pack) {
    throw new Error(`Entity not found: ${entityId}`);
  }
  const output = formatContextPack(pack, Boolean(options.json));
  console.log(output);
}
