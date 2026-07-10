export type TraceQualityTier =
  | "incomplete"
  | "minimal"
  | "standard"
  | "detailed";

const TIER_RANK: Record<TraceQualityTier, number> = {
  incomplete: 0,
  minimal: 1,
  standard: 2,
  detailed: 3,
};

export type TraceScoreSource = {
  id: number;
  task_summary: string;
  agent?: string | null;
  actions_taken?: string | null;
  files_read?: string | null;
  files_changed?: string | null;
  decisions_made?: string | null;
  errors?: string | null;
  outcome?: string | null;
  duration_ms?: number | null;
  harness_friction?: string | null;
  notes?: string | null;
  risk_lane?: string | null;
};

export type TraceScoreResult = {
  traceId: number;
  achieved: TraceQualityTier;
  required: TraceQualityTier | null;
  meetsRequirement: boolean;
  riskLane: string | null;
  missingMinimal: string[];
  missingStandard: string[];
  missingDetailed: string[];
};

function present(value: string | number | null | undefined): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "number") return true;
  return value.trim().length > 0;
}

function missingMinimal(source: TraceScoreSource): string[] {
  const missing: string[] = [];
  if (!present(source.task_summary)) missing.push("summary");
  if (!present(source.outcome)) missing.push("outcome");
  if (!present(source.files_changed)) missing.push("changed");
  return missing;
}

function missingStandard(source: TraceScoreSource): string[] {
  const missing: string[] = [];
  if (!present(source.agent)) missing.push("agent");
  if (!present(source.actions_taken)) missing.push("actions");
  if (!present(source.files_read)) missing.push("read");
  // errors OR friction should be present as a field (can be empty string marked)
  // Require explicit friction or errors key presence for standard: either field set
  if (!present(source.errors) && !present(source.harness_friction)) {
    missing.push("errors or harness_friction");
  }
  return missing;
}

function missingDetailed(source: TraceScoreSource): string[] {
  const missing: string[] = [];
  if (!present(source.duration_ms)) missing.push("duration");
  if (!present(source.decisions_made) && !present(source.notes)) {
    missing.push("decisions or notes");
  }
  return missing;
}

export function requiredTierForLane(
  lane: string | null | undefined,
): TraceQualityTier | null {
  if (!lane) return null;
  if (lane === "tiny") return "minimal";
  if (lane === "normal") return "standard";
  if (lane === "high_risk") return "detailed";
  return null;
}

export function scoreTrace(source: TraceScoreSource): TraceScoreResult {
  const missingMin = missingMinimal(source);
  const missingStd = missingMin.length === 0 ? missingStandard(source) : [];
  const missingDet =
    missingMin.length === 0 && missingStd.length === 0
      ? missingDetailed(source)
      : [];

  let achieved: TraceQualityTier = "incomplete";
  if (missingMin.length === 0 && missingStd.length === 0 && missingDet.length === 0) {
    achieved = "detailed";
  } else if (missingMin.length === 0 && missingStd.length === 0) {
    achieved = "standard";
  } else if (missingMin.length === 0) {
    achieved = "minimal";
  }

  const required = requiredTierForLane(source.risk_lane);
  const meetsRequirement =
    required === null || TIER_RANK[achieved] >= TIER_RANK[required];

  return {
    traceId: source.id,
    achieved,
    required,
    meetsRequirement,
    riskLane: source.risk_lane ?? null,
    missingMinimal: missingMin,
    missingStandard: missingStd,
    missingDetailed: missingDet,
  };
}

export function formatScoreResult(result: TraceScoreResult): string {
  const lines = [
    `Trace #${result.traceId}:`,
    `  Tier achieved: ${result.achieved}`,
  ];
  if (result.required) {
    lines.push(
      `  Lane: ${result.riskLane ?? "unknown"} -> required: ${result.required}`,
    );
    lines.push(
      result.meetsRequirement
        ? "  Meets lane requirement: yes"
        : "  Meets lane requirement: NO",
    );
  }
  const missing = [
    ...result.missingMinimal.map((m) => `minimal: ${m}`),
    ...result.missingStandard.map((m) => `standard: ${m}`),
    ...result.missingDetailed.map((m) => `detailed: ${m}`),
  ];
  if (missing.length > 0) {
    lines.push("  Missing:");
    for (const m of missing) lines.push(`    - ${m}`);
  }
  return lines.join("\n");
}
