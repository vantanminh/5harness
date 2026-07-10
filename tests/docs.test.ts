import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  executeDocsList,
  executeDocsSearch,
  executeDocsRead,
} from "../src/commands/docs.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-docs-"));
  tempDirs.push(dir);
  return dir;
}

/** Create a minimal harness docs/ tree for testing */
function scaffoldDocs(base: string): string {
  const docsDir = path.join(base, "docs");
  fs.mkdirSync(path.join(docsDir, "product"), { recursive: true });
  fs.writeFileSync(
    path.join(docsDir, "HARNESS.md"),
    "# Harness Guide\n\nThis is the harness guide.\n\nIt explains how to init a project with `harness init`.\n",
  );
  fs.writeFileSync(
    path.join(docsDir, "ARCHITECTURE.md"),
    "# Architecture\n\nThe architecture uses layers: domain, application, infrastructure, interface.\n",
  );
  fs.writeFileSync(
    path.join(docsDir, "product", "overview.md"),
    "# Product Overview\n\nA global npm CLI that turns any software repo into an agent-ready workspace.\n",
  );
  return docsDir;
}

function capture(fn: () => void): string {
  const orig = console.log;
  const parts: string[] = [];
  console.log = (...args: unknown[]) => {
    parts.push(args.map(String).join(" "));
  };
  try {
    fn();
  } finally {
    console.log = orig;
  }
  return parts.join("\n");
}

describe("docs list", () => {
  it("lists all doc files with titles", () => {
    const root = tmp();
    scaffoldDocs(root);
    const out = capture(() => executeDocsList({ packageRoot: root }));
    expect(out).toContain("HARNESS.md");
    expect(out).toContain("Harness Guide");
    expect(out).toContain("ARCHITECTURE.md");
    expect(out).toContain("product/overview.md");
    expect(out).toContain("Product Overview");
  });

  it("handles empty docs dir", () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, "docs"));
    const out = capture(() => executeDocsList({ packageRoot: root }));
    expect(out).toContain("No docs found");
  });
});

describe("docs search", () => {
  it("finds matching files with snippets", () => {
    const root = tmp();
    scaffoldDocs(root);
    const out = capture(() => executeDocsSearch("harness init", { packageRoot: root }));
    expect(out).toContain("HARNESS.md");
    expect(out).toContain("harness init");
  });

  it("returns empty for no match", () => {
    const root = tmp();
    scaffoldDocs(root);
    const out = capture(() => executeDocsSearch("zzzznonexistent", { packageRoot: root }));
    expect(out).toContain("No matching docs found");
  });

  it("throws on empty query", () => {
    const root = tmp();
    scaffoldDocs(root);
    expect(() => executeDocsSearch("   ", { packageRoot: root })).toThrow(
      "docs search requires a query string",
    );
  });
});

describe("docs read", () => {
  it("reads a doc file in full", () => {
    const root = tmp();
    scaffoldDocs(root);
    const out = capture(() => executeDocsRead("HARNESS.md", { packageRoot: root }));
    expect(out).toContain("# HARNESS.md");
    expect(out).toContain("harness init");
  });

  it("throws on missing file", () => {
    const root = tmp();
    scaffoldDocs(root);
    expect(() =>
      executeDocsRead("NOPE.md", { packageRoot: root }),
    ).toThrow("Doc not found");
  });

  it("throws on empty path", () => {
    expect(() => executeDocsRead("  ")).toThrow("docs read requires a path");
  });
});
