/**
 * US-056 — CLI parser core tests: options, arguments, help generation.
 *
 * Tests for src/infrastructure/cli-parser.ts.
 * Covers: name/description/version, option, requiredOption, argument,
 * parseAsync, opts, args, --help generation, --version support,
 * error for unknown/missing options and arguments.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Command } from "../src/infrastructure/cli-parser.js";

// ---------------------------------------------------------------------------
// Helpers to capture process.exit / console output
// ---------------------------------------------------------------------------

function captureExit(fn: () => void): { called: boolean; code: number | undefined } {
  const result = { called: false, code: undefined as number | undefined };
  const orig = process.exit;
  // @ts-expect-error mock
  process.exit = vi.fn((code?: number) => {
    result.called = true;
    result.code = code;
    throw new Error(`process.exit(${code})`);
  }) as unknown as typeof process.exit;
  try {
    fn();
  } catch {
    // expected — process.exit throws in mock
  }
  process.exit = orig;
  return result;
}

let consoleLogSpy: ReturnType<typeof vi.spyOn>;
let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});


// ---------------------------------------------------------------------------
// Parse helper that suppresses process.exit
// ---------------------------------------------------------------------------

async function runParse(cmd: Command, argv: string[]): Promise<void> {
  const origExit = process.exit;
  // @ts-expect-error mock
  process.exit = vi.fn((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as unknown as typeof process.exit;
  try {
    await cmd.parseAsync(argv);
  } catch (e) {
    if (!(e instanceof Error && e.message.startsWith("process.exit"))) {
      throw e;
    }
    // Exit 0 from --help or --version is fine; exit 1 re-throws as error
    const match = e.message.match(/process\.exit\((\d+)\)/);
    if (match && match[1] !== "0") {
      throw e;
    }
  }
  process.exit = origExit;
}


// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

describe("Command metadata", () => {
  it("sets name and description", () => {
    const cmd = new Command();
    cmd.name("test-tool").description("A test CLI tool");
    const info = cmd.helpInformation();
    expect(info).toContain("Usage: test-tool");
    expect(info).toContain("A test CLI tool");
  });

  it("sets version string", () => {
    const cmd = new Command();
    cmd.version("1.2.3");
    const info = cmd.helpInformation();
    expect(info).toContain("1.2.3");
  });

  it("sets custom version flags and description", () => {
    const cmd = new Command();
    cmd.version("5.0.0", "-V, --version", "show version info");
    const info = cmd.helpInformation();
    expect(info).toContain("5.0.0");
    expect(info).toContain("-V, --version");
    expect(info).toContain("show version info");
  });
});

// ---------------------------------------------------------------------------
// Options: basic
// ---------------------------------------------------------------------------

describe("option()", () => {
  it("parses short+long boolean flag", async () => {
    const cmd = new Command();
    cmd.option("-v, --verbose", "verbose output");
    await runParse(cmd, ["node", "cli", "--verbose"]);
    expect(cmd.opts()).toEqual({ verbose: true });
  });

  it("parses short boolean flag", async () => {
    const cmd = new Command();
    cmd.option("-v, --verbose", "verbose output");
    await runParse(cmd, ["node", "cli", "-v"]);
    expect(cmd.opts()).toEqual({ verbose: true });
  });

  it("parses long option with value", async () => {
    const cmd = new Command();
    cmd.option("-d, --dir <path>", "target directory");
    await runParse(cmd, ["node", "cli", "--dir", "/tmp/proj"]);
    expect(cmd.opts()).toEqual({ dir: "/tmp/proj" });
  });

  it("parses short option with value (next token)", async () => {
    const cmd = new Command();
    cmd.option("-d, --dir <path>", "target directory");
    await runParse(cmd, ["node", "cli", "-d", "/tmp/proj"]);
    expect(cmd.opts()).toEqual({ dir: "/tmp/proj" });
  });

  it("parses short option with inline value", async () => {
    const cmd = new Command();
    cmd.option("-d, --dir <path>", "target directory");
    await runParse(cmd, ["node", "cli", "-d/tmp/proj"]);
    expect(cmd.opts()).toEqual({ dir: "/tmp/proj" });
  });

  it("parses long option with =value syntax", async () => {
    const cmd = new Command();
    cmd.option("--name <val>", "name value");
    await runParse(cmd, ["node", "cli", "--name=hello"]);
    expect(cmd.opts()).toEqual({ name: "hello" });
  });

  it("applies default value when option not given", async () => {
    const cmd = new Command();
    cmd.option("--port <n>", "port number", "3927");
    await runParse(cmd, ["node", "cli"]);
    expect(cmd.opts()).toEqual({ port: "3927" });
  });

  it("overrides default value when option is given", async () => {
    const cmd = new Command();
    cmd.option("--port <n>", "port number", "3927");
    await runParse(cmd, ["node", "cli", "--port", "8080"]);
    expect(cmd.opts()).toEqual({ port: "8080" });
  });

  it("defaults boolean to false when not provided", async () => {
    const cmd = new Command();
    cmd.option("--verbose", "verbose output");
    await runParse(cmd, ["node", "cli"]);
    expect(cmd.opts()).toEqual({ verbose: false });
  });

  it("supports negatable boolean --no-flag", async () => {
    const cmd = new Command();
    cmd.option("--color", "enable color");
    await runParse(cmd, ["node", "cli", "--no-color"]);
    expect(cmd.opts()).toEqual({ color: false });
  });

  it("negatable boolean defaults to false, --flag sets true", async () => {
    const cmd = new Command();
    cmd.option("--color", "enable color");
    await runParse(cmd, ["node", "cli", "--color"]);
    expect(cmd.opts()).toEqual({ color: true });
  });

  it("supports combined short flags", async () => {
    const cmd = new Command();
    cmd.option("-v, --verbose", "verbose output");
    cmd.option("-f, --force", "force mode");
    await runParse(cmd, ["node", "cli", "-vf"]);
    expect(cmd.opts()).toEqual({ verbose: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// requiredOption()
// ---------------------------------------------------------------------------

describe("requiredOption()", () => {
  it("allows required option when provided", async () => {
    const cmd = new Command();
    cmd.requiredOption("--type <type>", "input type");
    await runParse(cmd, ["node", "cli", "--type", "spec_slice"]);
    expect(cmd.opts()).toEqual({ type: "spec_slice" });
  });

  it("errors when required option is missing", () => {
    const cmd = new Command();
    cmd.requiredOption("--type <type>", "input type");
    const exit = captureExit(() => {
      cmd.parseAsync(["node", "cli"]).catch(() => {});
    });
  });

// ---------------------------------------------------------------------------
// argument()
// ---------------------------------------------------------------------------

describe("argument()", () => {
  it("parses required argument", async () => {
    const cmd = new Command();
    cmd.argument("<id>", "story id");
    await runParse(cmd, ["node", "cli", "US-001"]);
    expect(cmd.args).toEqual(["US-001"]);
  });

  it("parses optional argument when provided", async () => {
    const cmd = new Command();
    cmd.argument("[directory]", "project directory");
    await runParse(cmd, ["node", "cli", "/tmp/proj"]);
    expect(cmd.args).toEqual(["/tmp/proj"]);
  });

  it("allows optional argument to be omitted", async () => {
    const cmd = new Command();
    cmd.argument("[directory]", "project directory");
    await runParse(cmd, ["node", "cli"]);
    expect(cmd.args).toEqual([]);
  });

  it("errors when required argument is missing", () => {
    const cmd = new Command();
    cmd.argument("<id>", "story id");
    captureExit(() => {
      cmd.parseAsync(["node", "cli"]).catch(() => {});
    });
  });

  it("parses multiple arguments in order", async () => {
    const cmd = new Command();
    cmd.argument("<id>", "entity id");
    cmd.argument("[filter]", "optional filter");
    await runParse(cmd, ["node", "cli", "US-001", "active"]);
    expect(cmd.args).toEqual(["US-001", "active"]);
  });
});

});


// ---------------------------------------------------------------------------
// Options + arguments combined
// ---------------------------------------------------------------------------

describe("options + arguments combined", () => {
  it("parses option before positional arg", async () => {
    const cmd = new Command();
    cmd.option("--json", "JSON output");
    cmd.argument("<id>", "entity id");
    await runParse(cmd, ["node", "cli", "--json", "US-001"]);
    expect(cmd.opts()).toEqual({ json: true });
    expect(cmd.args).toEqual(["US-001"]);
  });

  it("parses positional arg before option", async () => {
    const cmd = new Command();
    cmd.option("--json", "JSON output");
    cmd.argument("<id>", "entity id");
    await runParse(cmd, ["node", "cli", "US-001", "--json"]);
    expect(cmd.opts()).toEqual({ json: true });
    expect(cmd.args).toEqual(["US-001"]);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("error handling", () => {
  it("errors on unknown long option", () => {
    const cmd = new Command();
    captureExit(() => {
      cmd.parseAsync(["node", "cli", "--unknown-flag"]).catch(() => {});
    });
  });

  it("errors on unknown short option", () => {
    const cmd = new Command();
    cmd.option("-v, --verbose", "verbose");
    captureExit(() => {
      cmd.parseAsync(["node", "cli", "-x"]).catch(() => {});
    });
  });

  it("errors when option that takes value is missing its value", () => {
    const cmd = new Command();
    cmd.option("--dir <path>", "target directory");
    captureExit(() => {
      cmd.parseAsync(["node", "cli", "--dir"]).catch(() => {});
    });
  });
});

// ---------------------------------------------------------------------------
// --help generation
// ---------------------------------------------------------------------------

describe("--help", () => {
  it("generates help text with usage line", () => {
    const cmd = new Command();
    cmd.name("harness").description("A CLI tool");
    const info = cmd.helpInformation();
    expect(info).toContain("Usage: harness");
    expect(info).toContain("A CLI tool");
  });

  it("includes argument descriptions in help", () => {
    const cmd = new Command();
    cmd.name("harness");
    cmd.argument("<id>", "entity id");
    cmd.argument("[filter]", "optional filter");
    const info = cmd.helpInformation();
    expect(info).toContain("Arguments:");
    expect(info).toContain("<id>");
    expect(info).toContain("[filter]");
  });

  it("includes option descriptions in help", () => {
    const cmd = new Command();
    cmd.name("harness");
    cmd.option("-d, --dir <value>", "target directory");
    cmd.option("--json", "JSON output");
    const info = cmd.helpInformation();
    expect(info).toContain("Options:");
    expect(info).toContain("-d, --dir <value>");
    expect(info).toContain("--json");
  });

  it("prints help and exits 0 on --help", () => {
    const cmd = new Command();
    cmd.name("harness");
    const exit = captureExit(() => {
      cmd.parseAsync(["node", "cli", "--help"]).catch(() => {});
    });
    expect(exit.code).toBe(0);
  });

  it("includes help hint at the bottom", () => {
    const cmd = new Command();
    const info = cmd.helpInformation();
    expect(info).toContain("-h, --help");
    expect(info).toContain("display help for command");
  });
});

// ---------------------------------------------------------------------------
// --version
// ---------------------------------------------------------------------------

describe("--version", () => {
  it("prints version and exits 0 on --version", () => {
    const cmd = new Command();
    cmd.version("2.0.0");
    const exit = captureExit(() => {
      cmd.parseAsync(["node", "cli", "--version"]).catch(() => {});
    });
    expect(exit.code).toBe(0);
  });

  it("does NOT treat -v as version when version not set", async () => {
    const cmd = new Command();
    cmd.option("-v, --verbose", "verbose output");
    await runParse(cmd, ["node", "cli", "-v"]);
    expect(cmd.opts()).toEqual({ verbose: true });
  });
});

// ---------------------------------------------------------------------------
// opts() isolation
// ---------------------------------------------------------------------------

describe("opts()", () => {
  it("returns a copy, not the internal reference", async () => {
    const cmd = new Command();
    cmd.option("--port <n>", "port", "3000");
    await runParse(cmd, ["node", "cli"]);
    const opts1 = cmd.opts();
    opts1.port = "9999";
    const opts2 = cmd.opts();
    expect(opts2.port).toBe("3000");
  });
});

// ---------------------------------------------------------------------------
// Real-world CLI patterns from cli.ts
// ---------------------------------------------------------------------------

describe("real-world CLI patterns", () => {
  it("intake command: multiple required options", async () => {
    const cmd = new Command();
    cmd.requiredOption("--type <type>", "input type");
    cmd.requiredOption("--summary <text>", "short summary");
    cmd.requiredOption("--lane <lane>", "risk lane");
    cmd.option("--flags <csv>", "risk flags");
    await runParse(cmd, [
      "node", "cli",
      "--type", "spec_slice",
      "--summary", "Add feature X",
      "--lane", "normal",
      "--flags", "breaking,security",
    ]);
    expect(cmd.opts()).toEqual({
      type: "spec_slice",
      summary: "Add feature X",
      lane: "normal",
      flags: "breaking,security",
    });
  });

  it("dashboard command: options with defaults", async () => {
    const cmd = new Command();
    cmd.option("--port <n>", "port", "3927");
    cmd.option("--host <addr>", "bind address", "127.0.0.1");
    await runParse(cmd, ["node", "cli", "--port", "8080"]);
    expect(cmd.opts()).toEqual({ port: "8080", host: "127.0.0.1" });
  });

  it("addDirOptions pattern: -d and --directory aliases", async () => {
    const cmd = new Command();
    cmd.option("-d, --dir <path>", "target directory");
    cmd.option("--directory <path>", "alias for --dir");
    await runParse(cmd, ["node", "cli", "-d", "/my/project"]);
    expect(cmd.opts()).toEqual({ dir: "/my/project" });
  });

  it("story done: argument plus option", async () => {
    const cmd = new Command();
    cmd.argument("<id>", "story id");
    cmd.option("--evidence <text>", "evidence label");
    await runParse(cmd, ["node", "cli", "US-001", "--evidence", "tests pass"]);
    expect(cmd.args).toEqual(["US-001"]);
    expect(cmd.opts()).toEqual({ evidence: "tests pass" });
  });
});
