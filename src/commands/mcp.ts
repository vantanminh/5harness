import {
  resolveTargetFromOptions,
  type TargetOptions,
} from "../infrastructure/context.js";
import { startMcpServer } from "../application/mcp-server.js";

export type McpCliOptions = TargetOptions;

export function executeMcp(options: McpCliOptions): void {
  const { targetDir } = resolveTargetFromOptions(options);
  startMcpServer(targetDir);
}
