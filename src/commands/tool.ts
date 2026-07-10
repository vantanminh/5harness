import {
  resolveTargetFromOptions,
  type TargetOptions,
} from "../infrastructure/context.js";
import {
  registerTool,
  checkAllTools,
  removeTool,
  listAllTools,
} from "../application/tool-registry.js";
import { formatTable } from "../infrastructure/table.js";

export type ToolCliOptions = TargetOptions & {
  name?: string;
  kind?: string;
  command?: string;
  description?: string;
  responsibility?: string;
  capability?: string;
  scan?: string;
  args?: string;
  force?: boolean;
  json?: boolean;
};

export function executeToolRegister(options: ToolCliOptions): void {
  if (!options.name) throw new Error("--name is required for tool register");
  if (!options.command) throw new Error("--command is required for tool register");
  if (!options.description) throw new Error("--description is required for tool register");
  if (!options.responsibility) throw new Error("--responsibility is required for tool register");

  const { targetDir } = resolveTargetFromOptions(options);
  const tool = registerTool(targetDir, {
    name: options.name,
    kind: options.kind,
    command: options.command,
    description: options.description,
    responsibility: options.responsibility,
    capability: options.capability,
    scan: options.scan,
    args: options.args,
    force: options.force,
  });
  if (options.json) {
    console.log(JSON.stringify(tool, null, 2));
  } else {
    console.log(`Tool "${tool.name}" registered (kind: ${tool.kind}, status: ${tool.status ?? "unknown"}).`);
  }
}

export function executeToolCheck(options: ToolCliOptions): void {
  const { targetDir } = resolveTargetFromOptions(options);
  const results = checkAllTools(targetDir, options.name);
  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
  } else if (results.length === 0) {
    console.log("No registered tools to check.");
  } else {
    const rows = results.map((t) => ({
      name: t.name,
      kind: t.kind,
      capability: t.capability ?? "",
      status: t.status ?? "unknown",
      checked_at: t.checked_at ?? "",
    }));
    console.log(formatTable(rows, ["name", "kind", "capability", "status", "checked_at"]));
  }
}

export function executeToolRemove(options: ToolCliOptions): void {
  if (!options.name) throw new Error("--name is required for tool remove");
  const { targetDir } = resolveTargetFromOptions(options);
  const removed = removeTool(targetDir, options.name);
  if (options.json) {
    console.log(JSON.stringify(removed, null, 2));
  } else {
    console.log(`Tool "${removed?.name ?? options.name}" removed.`);
  }
}

export function executeToolList(options: ToolCliOptions): void {
  const { targetDir } = resolveTargetFromOptions(options);
  const tools = listAllTools(targetDir);
  if (options.json) {
    console.log(JSON.stringify(tools, null, 2));
  } else if (tools.length === 0) {
    console.log("No registered tools.");
  } else {
    const rows = tools.map((t) => ({
      name: t.name,
      kind: t.kind,
      capability: t.capability ?? "",
      responsibility: t.responsibility,
      status: t.status ?? "unknown",
      command: t.command,
    }));
    console.log(formatTable(rows, ["name", "kind", "capability", "responsibility", "status", "command"]));
  }
}
