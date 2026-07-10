import type { AuditFinding, AuditResult } from "../domain/audit.js";
import { asString } from "../domain/frontmatter.js";
import { listEntityFiles } from "../infrastructure/entities.js";
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

export function proposeFromProject(
  projectRoot: string,
  options: { commit?: boolean } = {},
): { proposals: Proposal[]; committed: number } {
  const audit = runAudit(projectRoot);
  const proposals = generateProposals(audit);
  let committed = 0;

  if (options.commit) {
    const openTitles = new Set(
      listEntityFiles(projectRoot, "backlog")
        .filter((f) => {
          const s = asString(f.data, "status");
          return s === "proposed" || s === "accepted";
        })
        .map((f) => asString(f.data, "title") ?? ""),
    );
    for (const p of proposals) {
      if (openTitles.has(p.title)) continue;
      addBacklogMd(
        { projectRoot },
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
      openTitles.add(p.title);
      committed += 1;
    }
  }

  return { proposals, committed };
}

/** @deprecated use proposeFromProject */
export function proposeFromDb(
  _db: unknown,
  options: { commit?: boolean; projectRoot?: string } = {},
): { proposals: Proposal[]; committed: number } {
  if (!options.projectRoot) {
    throw new Error("propose requires project root for markdown store");
  }
  return proposeFromProject(options.projectRoot, { commit: options.commit });
}
