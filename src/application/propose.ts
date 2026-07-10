import type { DatabaseSync } from "node:sqlite";
import type { AuditFinding, AuditResult } from "../domain/audit.js";
import { addBacklogMd } from "./md-durable.js";
import { runAudit } from "./quality.js";

export type Proposal = {
  title: string;
  component: string;
  evidence: string;
  predictedImpact: string;
  risk: "tiny" | "normal" | "high_risk";
  suggestedAction: string;
};

function proposalsFromFindings(
  component: string,
  findings: AuditFinding[],
  predictedImpact: string,
  suggestedAction: string,
  risk: Proposal["risk"] = "normal",
): Proposal[] {
  return findings.map((f) => ({
    title: `Address ${component}: ${f.id}`,
    component,
    evidence: `${f.id}: ${f.title}`,
    predictedImpact,
    risk,
    suggestedAction: `${suggestedAction} (${f.id})`,
  }));
}

export function generateProposals(audit: AuditResult): Proposal[] {
  const proposals: Proposal[] = [];
  proposals.push(
    ...proposalsFromFindings(
      "orphaned-stories",
      audit.orphanedStories,
      "Fewer abandoned planned stories; clearer agent handoff via traces",
      "Add a trace for the story or retire/close it",
      "normal",
    ),
  );
  proposals.push(
    ...proposalsFromFindings(
      "unverified-stories",
      audit.unverifiedStories,
      "Stronger completion evidence before marking work done",
      "Run harness story verify or clear unused verify_command",
      "normal",
    ),
  );
  proposals.push(
    ...proposalsFromFindings(
      "unverified-decisions",
      audit.unverifiedDecisions,
      "Decisions stay trustworthy with mechanical checks",
      "Run harness decision verify or remove stale verify_command",
      "tiny",
    ),
  );
  proposals.push(
    ...proposalsFromFindings(
      "open-backlog-outcomes",
      audit.backlogWithoutOutcomes,
      "Close the feedback loop on harness improvements",
      "Close the backlog item with --outcome or implement it",
      "tiny",
    ),
  );
  return proposals;
}

export function formatProposals(proposals: Proposal[]): string {
  if (proposals.length === 0) {
    return "No proposals — audit found nothing to improve (entropy clean).";
  }
  const blocks = proposals.map((p, i) =>
    [
      `### Proposal ${i + 1}: ${p.title}`,
      `component: ${p.component}`,
      `risk: ${p.risk === "high_risk" ? "high-risk" : p.risk}`,
      `evidence: ${p.evidence}`,
      `predicted_impact: ${p.predictedImpact}`,
      `suggested_action: ${p.suggestedAction}`,
    ].join("\n"),
  );
  return (
    `=== Improvement Proposals (${proposals.length}) ===\n\n` +
    blocks.join("\n\n")
  );
}

export function proposeFromDb(
  db: DatabaseSync,
  options: { commit?: boolean; projectRoot?: string } = {},
): { proposals: Proposal[]; committed: number } {
  const audit = runAudit(db);
  const proposals = generateProposals(audit);
  let committed = 0;

  if (options.commit) {
    for (const p of proposals) {
      const existing = db
        .prepare(
          `SELECT id FROM backlog
           WHERE title = ?
             AND status IN ('proposed', 'accepted')
           LIMIT 1`,
        )
        .get(p.title) as { id: number } | undefined;
      if (existing) continue;
      const projectRoot = options.projectRoot;
      if (!projectRoot) {
        throw new Error("propose --commit requires project root for markdown store");
      }
      addBacklogMd(
        { projectRoot, db },
        {
          title: p.title,
          while: "harness propose --commit",
          pain: p.evidence,
          suggestion: p.suggestedAction,
          risk: p.risk === "high_risk" ? "high-risk" : p.risk,
          predicted: p.predictedImpact,
          notes: `component=${p.component}`,
        },
      );
      committed += 1;
    }
  }

  return { proposals, committed };
}
