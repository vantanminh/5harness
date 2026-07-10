import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/** Max length for a story/decision verify command string. */
export const MAX_VERIFY_COMMAND_LENGTH = 4_096;

/** Default wall-clock limit for a single verify run (30 minutes). */
export const DEFAULT_VERIFY_TIMEOUT_MS = 30 * 60 * 1000;

/** Cap captured stdout/stderr so a noisy command cannot flood memory. */
export const DEFAULT_VERIFY_MAX_BUFFER = 10 * 1024 * 1024;

export type VerifyRunResult = {
  command: string;
  exitCode: number;
  pass: boolean;
  stdout: string;
  stderr: string;
};

export type RunVerifyOptions = {
  /** Override spawn timeout (ms). */
  timeoutMs?: number;
};

/**
 * Validate a project-authored verify command before execution.
 *
 * Trust model: the command string comes from local Git-backed story/decision
 * markdown (`verify` frontmatter). Running `harness story verify` is intentional
 * execution of that project-defined proof command — same class of risk as
 * running a CI `run:` script or `npm test` from the repo. Callers must not
 * pass network/untrusted input into this function.
 */
export function validateVerifyCommand(command: string): string {
  if (typeof command !== "string") {
    throw new Error("verify command must be a string");
  }
  const trimmed = command.trim();
  if (!trimmed) {
    throw new Error("verify command is empty");
  }
  if (trimmed.length > MAX_VERIFY_COMMAND_LENGTH) {
    throw new Error(
      `verify command exceeds ${MAX_VERIFY_COMMAND_LENGTH} characters`,
    );
  }
  if (trimmed.includes("\0")) {
    throw new Error("verify command must not contain null bytes");
  }
  // Disallow CR/LF so a single frontmatter value cannot smuggle multi-line shell.
  if (/[\r\n]/.test(trimmed)) {
    throw new Error("verify command must be a single line");
  }
  return trimmed;
}

export function resolveVerifyCwd(cwd: string): string {
  if (typeof cwd !== "string" || !cwd.trim()) {
    throw new Error("verify cwd is required");
  }
  if (cwd.includes("\0")) {
    throw new Error("verify cwd must not contain null bytes");
  }
  const resolved = path.resolve(cwd);
  let st: fs.Stats;
  try {
    st = fs.statSync(resolved);
  } catch {
    throw new Error(`verify cwd does not exist: ${resolved}`);
  }
  if (!st.isDirectory()) {
    throw new Error(`verify cwd is not a directory: ${resolved}`);
  }
  return resolved;
}

/**
 * Run a project-authored verify command with cwd = target project directory.
 *
 * Uses a shell so common proof commands work (`npm test`, `node -e "..."`,
 * `cargo test && cargo clippy`). The command is treated as trusted local
 * project config (see {@link validateVerifyCommand}).
 */
export function runVerifyCommand(
  command: string,
  cwd: string,
  options: RunVerifyOptions = {},
): VerifyRunResult {
  const safeCommand = validateVerifyCommand(command);
  const workDir = resolveVerifyCwd(cwd);
  const timeout = options.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;

  const result = spawnSync(safeCommand, {
    cwd: workDir,
    // Required for multi-word / platform shell scripts (npm.cmd, &&, quotes).
    // Input is project-authored frontmatter, not remote request data.
    shell: true,
    encoding: "utf8",
    env: process.env,
    timeout,
    maxBuffer: DEFAULT_VERIFY_MAX_BUFFER,
    windowsHide: true,
  });

  const timedOut = Boolean(
    result.error &&
      "code" in result.error &&
      (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT",
  );

  const exitCode =
    typeof result.status === "number"
      ? result.status
      : timedOut
        ? 124
        : result.error
          ? 1
          : 0;

  const stdout = result.stdout ?? "";
  let stderr = result.stderr ?? "";
  if (result.error) {
    stderr = stderr
      ? `${stderr}\n${result.error.message}`
      : result.error.message;
  }
  if (timedOut) {
    stderr = stderr
      ? `${stderr}\nverify command timed out after ${timeout}ms`
      : `verify command timed out after ${timeout}ms`;
  }

  return {
    command: safeCommand,
    exitCode,
    pass: exitCode === 0,
    stdout,
    stderr,
  };
}
