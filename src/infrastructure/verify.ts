import { spawnSync } from "node:child_process";

export type VerifyRunResult = {
  command: string;
  exitCode: number;
  pass: boolean;
  stdout: string;
  stderr: string;
};

/**
 * Run a shell verify command with cwd = target project directory.
 */
export function runVerifyCommand(
  command: string,
  cwd: string,
): VerifyRunResult {
  const result = spawnSync(command, {
    cwd,
    shell: true,
    encoding: "utf8",
    env: process.env,
  });

  const exitCode =
    typeof result.status === "number"
      ? result.status
      : result.error
        ? 1
        : 0;
  const stdout = result.stdout ?? "";
  const stderr =
    (result.stderr ?? "") +
    (result.error ? `\n${result.error.message}` : "");

  return {
    command,
    exitCode,
    pass: exitCode === 0,
    stdout,
    stderr,
  };
}
