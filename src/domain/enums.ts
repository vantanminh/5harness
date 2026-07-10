export const RISK_LANES = ["tiny", "normal", "high_risk"] as const;
export type RiskLane = (typeof RISK_LANES)[number];

export const INPUT_TYPES = [
  "new_spec",
  "spec_slice",
  "change_request",
  "new_initiative",
  "maintenance",
  "harness_improvement",
] as const;
export type InputType = (typeof INPUT_TYPES)[number];

export const STORY_STATUSES = [
  "planned",
  "in_progress",
  "implemented",
  "changed",
  "retired",
] as const;
export type StoryStatus = (typeof STORY_STATUSES)[number];

export const DECISION_STATUSES = [
  "proposed",
  "accepted",
  "superseded",
  "rejected",
] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

export const BACKLOG_STATUSES = [
  "proposed",
  "accepted",
  "implemented",
  "rejected",
] as const;
export type BacklogStatus = (typeof BACKLOG_STATUSES)[number];

function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/_+/g, "_");
}

export function parseRiskLane(raw: string): RiskLane {
  const normalized = slugify(raw);
  // accept high-risk, high_risk, highrisk
  const lane =
    normalized === "highrisk" || normalized === "high_risk"
      ? "high_risk"
      : normalized;
  if ((RISK_LANES as readonly string[]).includes(lane)) {
    return lane as RiskLane;
  }
  throw new Error(
    `Invalid risk lane "${raw}". Use tiny | normal | high-risk`,
  );
}

export function parseInputType(raw: string): InputType {
  const normalized = slugify(raw);
  const aliases: Record<string, InputType> = {
    new_spec: "new_spec",
    spec_slice: "spec_slice",
    change_request: "change_request",
    new_initiative: "new_initiative",
    maintenance: "maintenance",
    maintenance_request: "maintenance",
    harness_improvement: "harness_improvement",
  };
  const value = aliases[normalized];
  if (!value) {
    throw new Error(
      `Invalid input type "${raw}". Use new_spec | spec_slice | change_request | new_initiative | maintenance | harness_improvement`,
    );
  }
  return value;
}

export function parseStoryStatus(raw: string): StoryStatus {
  const normalized = slugify(raw);
  if ((STORY_STATUSES as readonly string[]).includes(normalized)) {
    return normalized as StoryStatus;
  }
  throw new Error(
    `Invalid story status "${raw}". Use ${STORY_STATUSES.join(" | ")}`,
  );
}

export function parseDecisionStatus(raw: string): DecisionStatus {
  const normalized = slugify(raw);
  if ((DECISION_STATUSES as readonly string[]).includes(normalized)) {
    return normalized as DecisionStatus;
  }
  throw new Error(
    `Invalid decision status "${raw}". Use ${DECISION_STATUSES.join(" | ")}`,
  );
}

export function parseBacklogStatus(raw: string): BacklogStatus {
  const normalized = slugify(raw);
  if ((BACKLOG_STATUSES as readonly string[]).includes(normalized)) {
    return normalized as BacklogStatus;
  }
  throw new Error(
    `Invalid backlog status "${raw}". Use ${BACKLOG_STATUSES.join(" | ")}`,
  );
}

/** Parse proof flags: only 0 or 1. */
export function parseProofFlag(raw: string, flagName: string): 0 | 1 {
  const v = raw.trim();
  if (v === "0") return 0;
  if (v === "1") return 1;
  throw new Error(
    `Invalid --${flagName} "${raw}". Use numeric booleans 0 or 1`,
  );
}

export function proofDisplay(value: number, numeric: boolean): string {
  if (numeric) return value ? "1" : "0";
  return value ? "yes" : "no";
}

export function laneDisplay(lane: string): string {
  return lane === "high_risk" ? "high-risk" : lane;
}
