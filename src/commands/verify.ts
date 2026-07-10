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
  id: string,
  options: TargetOptions,
): void {
  if (!id?.trim()) {
    throw new Error("story verify requires a story id");
  }
  const { targetDir } = resolveTargetFromOptions(options);
  const result = verifyStory(targetDir, id);
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
  id: string,
  options: TargetOptions,
): void {
  if (!id?.trim()) {
    throw new Error("decision verify requires a decision id");
  }
  const { targetDir } = resolveTargetFromOptions(options);
  const result = verifyDecision(targetDir, id);
  if (result.skipped) {
    console.log(`Decision ${result.id}: skipped (${result.reason})`);
    return;
  }
  console.log(
    `Decision ${result.id} verification: ${result.pass ? "pass" : "fail"}`,
  );
  if (!result.pass) process.exitCode = 1;
}
