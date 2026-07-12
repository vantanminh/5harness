import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  emptyToolRegistry,
  normalizeCapability,
  VALID_KINDS,
  type InboundTool,
  type ToolRegistry,
} from "../domain/tool-registry.js";
import { projectToolRegistryPath } from "../domain/paths.js";

export function toolRegistryPath(projectRoot: string): string {
  return projectToolRegistryPath(projectRoot);
}

export function readToolRegistry(projectRoot: string): ToolRegistry {
  const p = toolRegistryPath(projectRoot);
  if (!fs.existsSync(p)) return emptyToolRegistry();
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf8")) as ToolRegistry;
    if (!data || data.version !== 1) return emptyToolRegistry();
    if (!Array.isArray(data.tools)) return emptyToolRegistry();
    return data;
  } catch {
    return emptyToolRegistry();
  }
}

export function writeToolRegistry(
  projectRoot: string,
  registry: ToolRegistry,
): string {
  const p = toolRegistryPath(projectRoot);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(registry, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, p);
  return p;
}

export type RegisterToolInput = {
  name: string;
  kind?: string;
  command: string;
  description: string;
  responsibility: string;
  capability?: string;
  scan?: string;
  args?: string;
  force?: boolean;
};

export function registerTool(
  projectRoot: string,
  input: RegisterToolInput,
): InboundTool {
  const kind = (input.kind ?? "cli") as InboundTool["kind"];
  if (!VALID_KINDS.includes(kind)) {
    throw new Error(`Invalid --kind "${input.kind}". Use: ${VALID_KINDS.join(" | ")}`);
  }

  const capability = input.capability
    ? normalizeCapability(input.capability)
    : undefined;

  const name = input.name.trim();
  if (!name || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new Error(`Invalid tool name "${input.name}"`);
  }

  if (!input.description || input.description.length < 10 || input.description.length > 200) {
    throw new Error("Description must be 10-200 characters");
  }

  if (!input.command.trim()) {
    throw new Error("--command is required");
  }

  const registry = readToolRegistry(projectRoot);

  const existing = registry.tools.find((t) => t.name === name);
  if (existing) {
    throw new Error(`Tool "${name}" already registered. Use --name with a different name, or remove it first.`);
  }

  // Probe for cli/binary if not forced
  let status: InboundTool["status"] = "unknown";
  if (kind === "cli" || kind === "binary") {
    status = "unknown";
    if (!input.force) {
      status = probeCliPresence(input.command) ? "present" : "missing";
      if (status === "missing") {
        throw new Error(
          `Command "${input.command}" not found on PATH. Use --force to register anyway.`,
        );
      }
    }
  }

  const tool: InboundTool = {
    name,
    kind,
    command: input.command.trim(),
    description: input.description.trim(),
    responsibility: input.responsibility.trim(),
    capability,
    scan: input.scan?.trim() || undefined,
    args: input.args?.trim() || undefined,
    status: kind === "cli" || kind === "binary" ? status : "unknown",
    checked_at: kind === "cli" || kind === "binary" ? new Date().toISOString() : undefined,
  };

  registry.tools.push(tool);
  writeToolRegistry(projectRoot, registry);
  return tool;
}

export function removeTool(
  projectRoot: string,
  name: string,
): InboundTool | null {
  const registry = readToolRegistry(projectRoot);
  const idx = registry.tools.findIndex((t) => t.name === name);
  if (idx === -1) {
    throw new Error(`Tool "${name}" not registered.`);
  }
  const [removed] = registry.tools.splice(idx, 1);
  writeToolRegistry(projectRoot, registry);
  return removed ?? null;
}

function probeCliPresence(command: string): boolean {
  const cmd = command.split(/\s+/)[0] ?? command;
  // On Windows, check with where; else with which
  const whichCmd = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(whichCmd, [cmd], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 5000,
  });
  return result.status === 0 && result.stdout.trim().length > 0;
}

function probeScan(scan: string): boolean {
  const expanded = scan.startsWith("~")
    ? path.join(process.env.HOME ?? process.env.USERPROFILE ?? "", scan.slice(1))
    : scan;
  return fs.existsSync(expanded);
}

export function checkTool(
  projectRoot: string,
  tool: InboundTool,
): InboundTool {
  let status: InboundTool["status"] = "unknown";
  const kind = tool.kind;

  if (kind === "cli" || kind === "binary") {
    status = probeCliPresence(tool.command) ? "present" : "missing";
  } else if (kind === "mcp" || kind === "skill" || kind === "http") {
    const scanTarget = tool.scan ?? tool.command;
    if (kind === "http") {
      // For HTTP, we don't probe — mark as unknown (needs runtime)
      status = "unknown";
    } else {
      status = probeScan(scanTarget) ? "present" : "missing";
    }
  }

  return { ...tool, status, checked_at: new Date().toISOString() };
}

export function checkAllTools(
  projectRoot: string,
  nameFilter?: string,
): InboundTool[] {
  const registry = readToolRegistry(projectRoot);
  const tools = nameFilter
    ? registry.tools.filter((t) => t.name === nameFilter)
    : registry.tools;

  const results = tools.map((t) => checkTool(projectRoot, t));

  // Persist results
  for (const r of results) {
    const idx = registry.tools.findIndex((t) => t.name === r.name);
    if (idx !== -1) {
      registry.tools[idx] = r;
    }
  }
  writeToolRegistry(projectRoot, registry);

  return results;
}

export function listAllTools(projectRoot: string): InboundTool[] {
  return readToolRegistry(projectRoot).tools;
}
