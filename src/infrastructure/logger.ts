import fs from "node:fs";
import path from "node:path";
import { resolveHarnessHome } from "../domain/paths.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export type LoggerOptions = {
  env?: NodeJS.ProcessEnv;
  /** Project root; when set, also writes under project `.harness/logs/`. */
  projectRoot?: string;
  /** Override log file path. */
  logFile?: string;
  /** Force debug even without HARNESS_DEBUG. */
  debug?: boolean;
  now?: () => Date;
};

const SECRET_PATTERNS: RegExp[] = [
  /\b(api[_-]?key|token|secret|password|authorization|bearer)\s*[:=]\s*["']?([^\s"',}]+)/gi,
  /\b(npm_[A-Za-z0-9]{20,})\b/g,
  /\b(ghp_[A-Za-z0-9]{20,})\b/g,
  /\b(github_pat_[A-Za-z0-9_]{20,})\b/g,
  /\b(sk-[A-Za-z0-9]{20,})\b/g,
];

/**
 * Redact common secret shapes from log strings. Never reverse this for display.
 */
export function redactSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) {
    out = out.replace(re, (match, g1?: string) => {
      if (typeof g1 === "string" && /api|token|secret|password|authorization|bearer/i.test(g1)) {
        return `${g1}=***`;
      }
      return "***";
    });
  }
  return out;
}

export function isDebugEnabled(
  env: NodeJS.ProcessEnv = process.env,
  force?: boolean,
): boolean {
  if (force) return true;
  const v = env.HARNESS_DEBUG?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "debug";
}

/**
 * Default log directory: `$HARNESS_HOME/logs` (usually `~/.harness/logs`).
 */
export function resolveGlobalLogDir(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return path.join(resolveHarnessHome(env), "logs");
}

/**
 * Project-local log directory: `<project>/.harness/logs`.
 */
export function resolveProjectLogDir(projectRoot: string): string {
  return path.join(projectRoot, ".harness", "logs");
}

export function resolveDefaultLogFile(
  env: NodeJS.ProcessEnv = process.env,
  projectRoot?: string,
): string {
  const override = env.HARNESS_LOG_FILE?.trim();
  if (override) {
    return path.resolve(override);
  }
  if (projectRoot) {
    return path.join(resolveProjectLogDir(projectRoot), "harness.log");
  }
  return path.join(resolveGlobalLogDir(env), "harness.log");
}

export type Logger = {
  debug: (message: string, meta?: Record<string, unknown>) => void;
  info: (message: string, meta?: Record<string, unknown>) => void;
  warn: (message: string, meta?: Record<string, unknown>) => void;
  error: (message: string, meta?: Record<string, unknown>) => void;
  /** Absolute path of the primary log file (may not exist yet). */
  logFile: string;
  debugEnabled: boolean;
};

function formatLine(
  level: LogLevel,
  message: string,
  meta: Record<string, unknown> | undefined,
  now: Date,
): string {
  const ts = now.toISOString();
  const safeMsg = redactSecrets(message);
  let line = `${ts} [${level}] ${safeMsg}`;
  if (meta && Object.keys(meta).length > 0) {
    try {
      line += ` ${redactSecrets(JSON.stringify(meta))}`;
    } catch {
      line += " [meta:unserializable]";
    }
  }
  return line;
}

function appendLine(filePath: string, line: string): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, line + "\n", "utf8");
  } catch {
    // Logging must never crash the CLI.
  }
}

/**
 * Create a harness logger. Debug lines go to stderr when HARNESS_DEBUG is set;
 * all levels append to the log file when debug is on (or always for error).
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const env = options.env ?? process.env;
  const debugEnabled = isDebugEnabled(env, options.debug);
  const logFile =
    options.logFile ?? resolveDefaultLogFile(env, options.projectRoot);
  const now = options.now ?? (() => new Date());

  const write = (
    level: LogLevel,
    message: string,
    meta?: Record<string, unknown>,
  ): void => {
    const line = formatLine(level, message, meta, now());
    const toFile = debugEnabled || level === "error" || level === "warn";
    if (toFile) {
      appendLine(logFile, line);
    }
    if (debugEnabled && (level === "debug" || level === "info")) {
      console.error(line);
    }
  };

  return {
    logFile,
    debugEnabled,
    debug: (m, meta) => {
      if (debugEnabled) write("debug", m, meta);
    },
    info: (m, meta) => write("info", m, meta),
    warn: (m, meta) => write("warn", m, meta),
    error: (m, meta) => write("error", m, meta),
  };
}

/** Process-wide lazy logger (no project root). */
let defaultLogger: Logger | null = null;

export function getDefaultLogger(
  env: NodeJS.ProcessEnv = process.env,
): Logger {
  if (!defaultLogger) {
    defaultLogger = createLogger({ env });
  }
  return defaultLogger;
}

/** Test helper: reset singleton. */
export function resetDefaultLogger(): void {
  defaultLogger = null;
}
