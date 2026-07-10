import { INPUT_TYPES, RISK_LANES } from "../domain/enums.js";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export type IntakePlan = {
  suggestedType: string;
  suggestedLane: string;
  reasoning: string;
  affectedDocs: string[];
  suggestedStoryId: string | null;
};

function guessInputType(summary: string): string {
  const lower = summary.toLowerCase();
  if (/\b(harness|tool|cli|infra|internal)\b/.test(lower)) return "harness_improvement";
  if (/\b(new|brand new|from scratch|greenfield)\b/.test(lower)) return "new_spec";
  if (/\b(slice|partial|part of|subset|incremental)\b/.test(lower)) return "spec_slice";
  if (/\b(change|modify|update|refactor)\b/.test(lower)) return "change_request";
  if (/\b(bug|fix|repair|broken|issue)\b/.test(lower)) return "maintenance";
  if (/\b(initiative|epic|program|project)\b/.test(lower)) return "new_initiative";
  return "spec_slice";
}

function guessRiskLane(summary: string): string {
  const lower = summary.toLowerCase();
  if (/\b(risky|dangerous|breaking|auth|security|data loss|schema)\b/.test(lower)) return "high_risk";
  if (/\b(simple|tiny|trivial|one word|cosmetic|typo|docs only)\b/.test(lower)) return "tiny";
  return "normal";
}

function scanAffectedDocs(
  summary: string,
  projectRoot: string,
): string[] {
  const docs: string[] = [];
  const lower = summary.toLowerCase();

  const knownDocMappings: Array<{ pattern: RegExp; doc: string[] }> = [
    { pattern: /\b(init|scaffold|install)\b/, doc: ["docs/HARNESS.md"] },
    { pattern: /\b(doctor|health check)\b/, doc: ["docs/product/cli-contract.md"] },
    { pattern: /\b(status|snapshot)\b/, doc: ["docs/product/cli-contract.md"] },
    { pattern: /\b(context|entity pack|links)\b/, doc: ["docs/CONTEXT_RULES.md"] },
    { pattern: /\b(tool|register|inbound)\b/, doc: ["docs/TOOL_REGISTRY.md"] },
    { pattern: /\b(story|lifecycle|start done block)\b/, doc: ["docs/stories/README.md"] },
    { pattern: /\b(worklog|commit|pr link)\b/, doc: ["docs/product/cli-contract.md"] },
    { pattern: /\b(intake|classification)\b/, doc: ["docs/FEATURE_INTAKE.md"] },
    { pattern: /\b(dashboard|ui)\b/, doc: ["docs/product/cli-contract.md"] },
    { pattern: /\b(decision|architecture)\b/, doc: ["docs/ARCHITECTURE.md"] },
    { pattern: /\b(mcp|server|protocol)\b/, doc: ["docs/TOOL_REGISTRY.md"] },
    { pattern: /\b(export|changelog|release)\b/, doc: ["CHANGELOG.md"] },
    { pattern: /\b(watch|reindex)\b/, doc: ["docs/product/cli-contract.md"] },
    { pattern: /\b(handoff|session)\b/, doc: ["docs/CONTEXT_RULES.md"] },
    { pattern: /\b(agent|rules)\b/, doc: ["AGENTS.md"] },
    { pattern: /\b(test|quality|verify|proof)\b/, doc: ["docs/product/cli-contract.md"] },
    { pattern: /\b(upgrade|version)\b/, doc: ["AGENTS.md"] },
  ];

  for (const { pattern, doc } of knownDocMappings) {
    if (pattern.test(lower)) {
      for (const d of doc) {
        if (!docs.includes(d)) docs.push(d);
      }
    }
  }

  // Always suggest key docs if they exist
  const alwaysCheck = [
    "AGENTS.md",
    "docs/FEATURE_INTAKE.md",
    "docs/product/roadmap.md",
    "docs/ARCHITECTURE.md",
    "docs/CONTEXT_RULES.md",
  ];
  for (const d of alwaysCheck) {
    if (existsSync(resolve(projectRoot, d)) && !docs.includes(d)) {
      docs.push(d);
    }
  }

  return docs;
}

function suggestStoryId(summary: string): string | null {
  const lower = summary.toLowerCase();
  if (/\bus-?\d{3}\b/i.test(lower)) {
    const m = lower.match(/\b(us-?\d{3})\b/i);
    if (m?.[1]) return m[1].toUpperCase().replace(/(US)(\d)/, "US-$2");
  }
  return null;
}

export function runIntakePlan(
  summary: string,
  projectRoot: string,
): IntakePlan {
  const suggestedType = guessInputType(summary);
  const suggestedLane = guessRiskLane(summary);
  const affectedDocs = scanAffectedDocs(summary, projectRoot);
  const suggestedStoryId = suggestStoryId(summary);

  let reasoning = "";
  switch (suggestedType) {
    case "harness_improvement":
      reasoning = "Mentions harness internal keywords (tool/cli/infra)";
      break;
    case "new_spec":
      reasoning = "Mentions new/greenfield creation";
      break;
    case "spec_slice":
      reasoning = "Mentions incremental/partial work";
      break;
    case "change_request":
      reasoning = "Mentions change/modify/refactor";
      break;
    case "maintenance":
      reasoning = "Mentions bug/fix/repair";
      break;
    case "new_initiative":
      reasoning = "Mentions initiative/epic";
      break;
    default:
      reasoning = "Default classification";
  }

  return {
    suggestedType,
    suggestedLane,
    reasoning,
    affectedDocs,
    suggestedStoryId,
  };
}

export function formatIntakePlan(plan: IntakePlan, json: boolean): string {
  if (json) {
    return JSON.stringify(plan, null, 2);
  }

  return [
    "=== Intake Plan ===",
    "",
    `  Suggested type: ${plan.suggestedType}`,
    `  Suggested lane: ${plan.suggestedLane}`,
    `  Reasoning: ${plan.reasoning}`,
    `  Story hint: ${plan.suggestedStoryId ?? "none detected"}`,
    "",
    "  Affected docs:",
    ...plan.affectedDocs.map((d) => `    - ${d}`),
    "",
    plan.suggestedStoryId
      ? `  🏃 Try: harness intake --type ${plan.suggestedType} --summary "..." --lane ${plan.suggestedLane}`
      : `  🏃 Try: harness intake --type ${plan.suggestedType} --summary "..." --lane ${plan.suggestedLane}`,
  ].join("\n");
}
