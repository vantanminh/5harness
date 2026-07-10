export type AuditFinding = { id: string; title: string };

export type AuditResult = {
  orphanedStories: AuditFinding[];
  unverifiedStories: AuditFinding[];
  unverifiedDecisions: AuditFinding[];
  backlogWithoutOutcomes: AuditFinding[];
  entropyScore: number;
};

export function computeEntropy(result: Omit<AuditResult, "entropyScore">): number {
  const raw =
    result.orphanedStories.length * 10 +
    result.unverifiedStories.length * 5 +
    result.unverifiedDecisions.length * 5 +
    result.backlogWithoutOutcomes.length * 2;
  return Math.min(100, raw);
}

export function formatAudit(result: AuditResult): string {
  const section = (title: string, items: AuditFinding[]) => {
    const head = `${title}: ${items.length}`;
    if (items.length === 0) return head;
    return (
      head +
      "\n" +
      items.map((i) => `  - ${i.id}: ${i.title}`).join("\n")
    );
  };

  return [
    "=== Harness Drift Audit ===",
    "",
    section("Orphaned stories (planned/in_progress, no traces)", result.orphanedStories),
    "",
    section("Unverified stories (have verify_command, never passed)", result.unverifiedStories),
    "",
    section("Unverified decisions (have verify_command, never passed)", result.unverifiedDecisions),
    "",
    section("Open backlog without outcomes", result.backlogWithoutOutcomes),
    "",
    `Entropy score: ${result.entropyScore}/100 (lower is better)`,
  ].join("\n");
}
