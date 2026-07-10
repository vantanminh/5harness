export type ToolEntry = {
  name: string;
  kind: "builtin";
  capability: string;
  responsibility: string;
  status: "present";
  source: "compiled";
};

/** Built-in product CLI surface exposed as a tool registry for agents. */
export const BUILTIN_TOOLS: ToolEntry[] = [
  {
    name: "init",
    kind: "builtin",
    capability: "scaffold",
    responsibility: "Install operating files and create DB",
    status: "present",
    source: "compiled",
  },
  {
    name: "migrate",
    kind: "builtin",
    capability: "task-state",
    responsibility: "Apply SQL migrations",
    status: "present",
    source: "compiled",
  },
  {
    name: "intake",
    kind: "builtin",
    capability: "task-specification",
    responsibility: "Classify work before implementation",
    status: "present",
    source: "compiled",
  },
  {
    name: "story add",
    kind: "builtin",
    capability: "task-state",
    responsibility: "Add story matrix row",
    status: "present",
    source: "compiled",
  },
  {
    name: "story update",
    kind: "builtin",
    capability: "task-state",
    responsibility: "Update story status and proof flags",
    status: "present",
    source: "compiled",
  },
  {
    name: "story verify",
    kind: "builtin",
    capability: "verification",
    responsibility: "Run story verify_command",
    status: "present",
    source: "compiled",
  },
  {
    name: "story verify-all",
    kind: "builtin",
    capability: "verification",
    responsibility: "Verify all configured stories",
    status: "present",
    source: "compiled",
  },
  {
    name: "decision add",
    kind: "builtin",
    capability: "project-memory",
    responsibility: "Record durable decision",
    status: "present",
    source: "compiled",
  },
  {
    name: "decision verify",
    kind: "builtin",
    capability: "verification",
    responsibility: "Run decision verify_command",
    status: "present",
    source: "compiled",
  },
  {
    name: "backlog add",
    kind: "builtin",
    capability: "entropy-auditing",
    responsibility: "Add improvement backlog item",
    status: "present",
    source: "compiled",
  },
  {
    name: "backlog close",
    kind: "builtin",
    capability: "entropy-auditing",
    responsibility: "Close backlog item with outcome",
    status: "present",
    source: "compiled",
  },
  {
    name: "trace",
    kind: "builtin",
    capability: "observability",
    responsibility: "Record agent execution trace",
    status: "present",
    source: "compiled",
  },
  {
    name: "score-trace",
    kind: "builtin",
    capability: "observability",
    responsibility: "Score trace quality tiers",
    status: "present",
    source: "compiled",
  },
  {
    name: "audit",
    kind: "builtin",
    capability: "entropy-auditing",
    responsibility: "Drift audit and entropy score",
    status: "present",
    source: "compiled",
  },
  {
    name: "propose",
    kind: "builtin",
    capability: "entropy-auditing",
    responsibility: "Generate proposals from audit findings",
    status: "present",
    source: "compiled",
  },
  {
    name: "query matrix",
    kind: "builtin",
    capability: "task-state",
    responsibility: "Show story proof matrix",
    status: "present",
    source: "compiled",
  },
  {
    name: "query stats",
    kind: "builtin",
    capability: "task-state",
    responsibility: "Show durable counts",
    status: "present",
    source: "compiled",
  },
  {
    name: "query intakes",
    kind: "builtin",
    capability: "task-specification",
    responsibility: "List intakes",
    status: "present",
    source: "compiled",
  },
  {
    name: "query decisions",
    kind: "builtin",
    capability: "project-memory",
    responsibility: "List decisions",
    status: "present",
    source: "compiled",
  },
  {
    name: "query stories",
    kind: "builtin",
    capability: "task-state",
    responsibility: "List stories",
    status: "present",
    source: "compiled",
  },
  {
    name: "query backlog",
    kind: "builtin",
    capability: "entropy-auditing",
    responsibility: "List backlog items",
    status: "present",
    source: "compiled",
  },
  {
    name: "query traces",
    kind: "builtin",
    capability: "observability",
    responsibility: "List traces",
    status: "present",
    source: "compiled",
  },
  {
    name: "query tools",
    kind: "builtin",
    capability: "tool-access",
    responsibility: "List equipped harness tools",
    status: "present",
    source: "compiled",
  },
];

export function listTools(filter?: {
  capability?: string;
  status?: string;
}): ToolEntry[] {
  return BUILTIN_TOOLS.filter((t) => {
    if (filter?.capability && t.capability !== filter.capability) return false;
    if (filter?.status && t.status !== filter.status) return false;
    return true;
  });
}
