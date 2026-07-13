import { randomBytes } from "node:crypto";
import { extractHarnessBlock, HARNESS_BEGIN } from "./upgrade.js";

const PROJECT_ID_RE = /<!--\s*harness-project-id:\s*([A-Za-z0-9_-]+)\s*-->/;
const VALID_PROJECT_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;

export function generateProjectId(): string {
  return randomBytes(16).toString("hex");
}

export function extractProjectId(agentsText: string): string | null {
  const block = extractHarnessBlock(agentsText);
  if (!block) return null;
  const match = PROJECT_ID_RE.exec(block.block);
  return match?.[1] ?? null;
}

export function insertProjectIdMarker(
  agentsText: string,
  projectId: string,
): string {
  if (!VALID_PROJECT_ID_RE.test(projectId)) {
    throw new Error("Invalid harness project id.");
  }
  if (extractProjectId(agentsText)) return agentsText;

  const extracted = extractHarnessBlock(agentsText);
  if (!extracted) {
    throw new Error(
      "AGENTS.md has no harness-managed block. Run `harness init --force` first.",
    );
  }

  const newline = extracted.block.includes("\r\n") ? "\r\n" : "\n";
  const marker = `<!-- harness-project-id: ${projectId} -->`;
  const versionPattern = /^(<!--\s*harness-version:[^\r\n]*-->)/m;
  const updatedBlock = versionPattern.test(extracted.block)
    ? extracted.block.replace(versionPattern, `$1${newline}${marker}`)
    : extracted.block.replace(HARNESS_BEGIN, `${HARNESS_BEGIN}${newline}${marker}`);

  return extracted.before + updatedBlock + extracted.after;
}
