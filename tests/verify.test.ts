import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_VERIFY_COMMAND_LENGTH,
  resolveVerifyCwd,
  runVerifyCommand,
  validateVerifyCommand,
} from "../src/infrastructure/verify.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-verify-"));
  tempDirs.push(dir);
  return dir;
}

describe("validateVerifyCommand", () => {
  it("trims and accepts a normal command", () => {
    expect(validateVerifyCommand("  npm test  ")).toBe("npm test");
  });

  it("rejects empty, null bytes, newlines, and overlong commands", () => {
    expect(() => validateVerifyCommand("   ")).toThrow(/empty/);
    expect(() => validateVerifyCommand("npm\0test")).toThrow(/null/);
    expect(() => validateVerifyCommand("npm test\nrm -rf /")).toThrow(
      /single line/,
    );
    expect(() =>
      validateVerifyCommand("x".repeat(MAX_VERIFY_COMMAND_LENGTH + 1)),
    ).toThrow(/exceeds/);
  });
});

describe("resolveVerifyCwd", () => {
  it("resolves an existing directory", () => {
    const dir = tempDir();
    expect(resolveVerifyCwd(dir)).toBe(path.resolve(dir));
  });

  it("rejects missing paths and files", () => {
    const dir = tempDir();
    expect(() => resolveVerifyCwd(path.join(dir, "nope"))).toThrow(
      /does not exist/,
    );
    const file = path.join(dir, "f.txt");
    fs.writeFileSync(file, "x");
    expect(() => resolveVerifyCwd(file)).toThrow(/not a directory/);
  });
});

describe("runVerifyCommand", () => {
  it("runs a simple node command and captures exit code", () => {
    const dir = tempDir();
    const ok = runVerifyCommand('node -e "process.exit(0)"', dir);
    expect(ok.pass).toBe(true);
    expect(ok.exitCode).toBe(0);

    const fail = runVerifyCommand('node -e "process.exit(2)"', dir);
    expect(fail.pass).toBe(false);
    expect(fail.exitCode).toBe(2);
  });

  it("rejects invalid command before spawn", () => {
    const dir = tempDir();
    expect(() => runVerifyCommand("cmd\nwith\nnewlines", dir)).toThrow(
      /single line/,
    );
  });
});
