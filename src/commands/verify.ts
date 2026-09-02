import {
  verifyAllStories,
  verifyDecision,
  verifyStory,
  type StoryVerifyResult,
} from "../application/quality.js";
import {
  resolveTargetFromOptions,
  type TargetOptions,
} from "../infrastructure/context.js";
import { resolveEntityId } from "./_entity-id.js";

function printStoryResult(result: StoryVerifyResult): void {
  if (result.skipped) {
    console.log(`Story ${result.id}: skipped (${result.reason})`);
    return;
  }
  const status = result.pass ? "pass" : "fail";
  console.log(
    `Story ${result.id} verification: ${status}` +
      (result.command ? ` (${result.command})` : ""),
  );
}

export function executeStoryVerify(
  id: string | undefined,
  options: TargetOptions & { id?: string },
): void {
  const resolved = resolveEntityId(id, options.id, "story verify");
  const { targetDir } = resolveTargetFromOptions(options);
  const result = verifyStory(targetDir, resolved);
  printStoryResult(result);
  if (!result.skipped && !result.pass) {
    process.exitCode = 1;
  }
}

export function executeStoryVerifyAll(options: TargetOptions): void {
  const { targetDir } = resolveTargetFromOptions(options);
  const results = verifyAllStories(targetDir);
  if (results.length === 0) {
    console.log("No stories with verify_command configured.");
    return;
  }
  let failed = 0;
  for (const r of results) {
    printStoryResult(r);
    if (!r.skipped && !r.pass) failed += 1;
  }
  console.log(
    `verify-all: ${results.length - failed} passed/skipped, ${failed} failed`,
  );
  if (failed > 0) process.exitCode = 1;
}

export function executeDecisionVerify(
  id: string | undefined,
  options: TargetOptions & { id?: string },
): void {
  const resolved = resolveEntityId(id, options.id, "decision verify");
  const { targetDir } = resolveTargetFromOptions(options);
  const result = verifyDecision(targetDir, resolved);
  if (result.skipped) {
    console.log(`Decision ${result.id}: skipped (${result.reason})`);
    return;
  }
  console.log(
    `Decision ${result.id} verification: ${result.pass ? "pass" : "fail"}`,
  );
  if (!result.pass) process.exitCode = 1;
}
