export type InboundTool = {
  name: string;
  kind: "cli" | "binary" | "mcp" | "skill" | "http";
  command: string;
  description: string;
  responsibility: string;
  capability?: string;
  scan?: string;
  args?: string;
  /** Present/missing/unknown persisted by tool check */
  status?: "present" | "missing" | "unknown";
  checked_at?: string;
};

export type ToolRegistry = {
  version: 1;
  tools: InboundTool[];
};

export function emptyToolRegistry(): ToolRegistry {
  return { version: 1, tools: [] };
}

export const VALID_KINDS = ["cli", "binary", "mcp", "skill", "http"] as const;

export function normalizeCapability(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

export const VALID_RESPONSIBILITIES = [
  "Install operating files and create DB",
  "Legacy: migrate existing harness.db if present",
  "Import legacy harness.db into markdown entities",
  "Register project in global registry",
  "Remove project from global registry",
  "List linked projects",
  "Local multi-project read-only dashboard",
  "Classify work before implementation",
  "Add story matrix row",
  "Update story status and proof flags",
  "Run story verify_command",
  "Verify all configured stories",
  "Record durable decision",
  "Run decision verify_command",
  "Add improvement backlog item",
  "Close backlog item with outcome",
  "Record an execution trace",
  "Score trace detail against lane requirements",
  "Run drift checks and compute entropy score",
  "Generate proposals from audit findings",
  "Show story proof matrix",
  "Show durable counts",
  "List intakes",
  "List decisions",
  "List stories",
  "List backlog items",
  "List traces",
  "List equipped harness tools",
  "Rebuild derived markdown index",
  "Load one entity by id/path",
  "Search entities (snippet results)",
  "Show outbound/backlinks for an entity",
  "Search harness own docs (snippet results)",
  "List all harness docs with titles",
  "Read one harness doc file in full",
  // Extension-friendly
  "Verification",
  "Impact Analysis",
  "Deploy Verification",
  "Linting",
  "Code Generation",
  "Testing",
  "Documentation",
  "Monitoring",
] as const;
