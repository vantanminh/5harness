import { describe, expect, it } from "vitest";
import {
  ERROR_CODES,
  HarnessError,
  formatErrorHuman,
  formatErrorJson,
  toHarnessError,
  wantsJsonErrors,
} from "../src/domain/errors.js";

describe("HarnessError (US-033)", () => {
  it("constructs with default INTERNAL code and exit 1", () => {
    const e = new HarnessError("boom");
    expect(e.code).toBe(ERROR_CODES.INTERNAL);
    expect(e.exitCode).toBe(1);
    expect(e.message).toBe("boom");
  });

  it("factories set stable codes", () => {
    expect(HarnessError.notFound("missing").code).toBe(ERROR_CODES.NOT_FOUND);
    expect(HarnessError.validation("bad").code).toBe(ERROR_CODES.VALIDATION);
    expect(HarnessError.usage("args").code).toBe(ERROR_CODES.USAGE);
    expect(HarnessError.state("init first").code).toBe(ERROR_CODES.STATE);
    expect(HarnessError.io("disk").code).toBe(ERROR_CODES.IO);
  });

  it("formats human and JSON lines", () => {
    const e = HarnessError.notFound("Entity not found: US-999", { id: "US-999" });
    expect(formatErrorHuman(e)).toBe(
      "error: HARNESS_E_NOT_FOUND: Entity not found: US-999",
    );
    const json = JSON.parse(formatErrorJson(e)) as {
      ok: boolean;
      code: string;
      message: string;
      exitCode: number;
      details?: { id: string };
    };
    expect(json.ok).toBe(false);
    expect(json.code).toBe("HARNESS_E_NOT_FOUND");
    expect(json.message).toBe("Entity not found: US-999");
    expect(json.exitCode).toBe(1);
    expect(json.details?.id).toBe("US-999");
  });

  it("toHarnessError preserves HarnessError and infers codes from messages", () => {
    const original = HarnessError.validation("invalid lane");
    expect(toHarnessError(original)).toBe(original);

    expect(toHarnessError(new Error("Entity not found: X")).code).toBe(
      ERROR_CODES.NOT_FOUND,
    );
    expect(toHarnessError(new Error("Run `harness init` first")).code).toBe(
      ERROR_CODES.STATE,
    );
    expect(toHarnessError(new Error("invalid status")).code).toBe(
      ERROR_CODES.VALIDATION,
    );
    expect(toHarnessError("plain string").code).toBe(ERROR_CODES.INTERNAL);
  });

  it("wantsJsonErrors reads env", () => {
    expect(wantsJsonErrors({})).toBe(false);
    expect(wantsJsonErrors({ HARNESS_JSON_ERRORS: "1" })).toBe(true);
    expect(wantsJsonErrors({ HARNESS_JSON_ERRORS: "true" })).toBe(true);
    expect(wantsJsonErrors({ HARNESS_JSON_ERRORS: "0" })).toBe(false);
  });
});
