/**
 * Structured harness errors (US-033 / decision 0017 companion).
 *
 * Codes are stable agent-facing identifiers (HARNESS_E_*). CLI `fail()` prints
 * them in human form and optionally as JSON (HARNESS_JSON_ERRORS=1).
 */

export const ERROR_CODES = {
  USAGE: "HARNESS_E_USAGE",
  VALIDATION: "HARNESS_E_VALIDATION",
  NOT_FOUND: "HARNESS_E_NOT_FOUND",
  STATE: "HARNESS_E_STATE",
  IO: "HARNESS_E_IO",
  INTERNAL: "HARNESS_E_INTERNAL",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export type HarnessErrorOptions = {
  code?: ErrorCode;
  exitCode?: number;
  /** Safe, non-secret details for debug/JSON (will be redacted if logged). */
  details?: Record<string, unknown>;
  cause?: unknown;
};

/**
 * Typed operational error for harness CLI and application layers.
 */
export class HarnessError extends Error {
  readonly code: ErrorCode;
  readonly exitCode: number;
  readonly details: Record<string, unknown> | undefined;

  constructor(message: string, options: HarnessErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "HarnessError";
    this.code = options.code ?? ERROR_CODES.INTERNAL;
    this.exitCode = options.exitCode ?? 1;
    this.details = options.details;
  }

  static usage(message: string, details?: Record<string, unknown>): HarnessError {
    return new HarnessError(message, {
      code: ERROR_CODES.USAGE,
      details,
    });
  }

  static validation(
    message: string,
    details?: Record<string, unknown>,
  ): HarnessError {
    return new HarnessError(message, {
      code: ERROR_CODES.VALIDATION,
      details,
    });
  }

  static notFound(
    message: string,
    details?: Record<string, unknown>,
  ): HarnessError {
    return new HarnessError(message, {
      code: ERROR_CODES.NOT_FOUND,
      details,
    });
  }

  static state(
    message: string,
    details?: Record<string, unknown>,
  ): HarnessError {
    return new HarnessError(message, {
      code: ERROR_CODES.STATE,
      details,
    });
  }

  static io(message: string, details?: Record<string, unknown>): HarnessError {
    return new HarnessError(message, {
      code: ERROR_CODES.IO,
      details,
    });
  }

  toJSON(): {
    ok: false;
    code: ErrorCode;
    message: string;
    exitCode: number;
    details?: Record<string, unknown>;
  } {
    return {
      ok: false,
      code: this.code,
      message: this.message,
      exitCode: this.exitCode,
      ...(this.details ? { details: this.details } : {}),
    };
  }
}

/**
 * Normalize any thrown value into a HarnessError.
 * Plain Error → HARNESS_E_INTERNAL (or inferred from message heuristics).
 */
export function toHarnessError(error: unknown): HarnessError {
  if (error instanceof HarnessError) return error;

  const message =
    error instanceof Error ? error.message : String(error ?? "Unknown error");

  const inferred = inferCodeFromMessage(message);
  return new HarnessError(message, {
    code: inferred,
    cause: error instanceof Error ? error : undefined,
  });
}

function inferCodeFromMessage(message: string): ErrorCode {
  const m = message.toLowerCase();
  if (
    m.includes("not found") ||
    m.includes("does not exist") ||
    m.includes("missing")
  ) {
    return ERROR_CODES.NOT_FOUND;
  }
  if (
    m.includes("invalid") ||
    m.includes("required") ||
    m.includes("must be") ||
    m.includes("unknown")
  ) {
    return ERROR_CODES.VALIDATION;
  }
  if (
    m.includes("run `harness init`") ||
    m.includes("run harness init") ||
    m.includes("not a harness") ||
    m.includes("not linked")
  ) {
    return ERROR_CODES.STATE;
  }
  if (
    m.includes("eacces") ||
    m.includes("eperm") ||
    m.includes("enoent") ||
    m.includes("permission")
  ) {
    return ERROR_CODES.IO;
  }
  return ERROR_CODES.INTERNAL;
}

/**
 * Human one-line form: `error: HARNESS_E_CODE: message`
 */
export function formatErrorHuman(error: HarnessError): string {
  return `error: ${error.code}: ${error.message}`;
}

/**
 * Machine-readable JSON line (single object, no secrets guaranteed by caller).
 */
export function formatErrorJson(error: HarnessError): string {
  return JSON.stringify(error.toJSON());
}

export function wantsJsonErrors(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const v = env.HARNESS_JSON_ERRORS?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}
