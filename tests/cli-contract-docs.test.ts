import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VERSION } from "../src/version.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

/** Policy surfaces agents treat as live procedure (decision 0023). */
const POLICY_DOCS = [
  "docs/HARNESS.md",
  "docs/TOOL_REGISTRY.md",
  "docs/GLOSSARY.md",
  "docs/IMPROVEMENT_PROTOCOL.md",
  "docs/WORKFLOW_VI.md",
  "docs/product/cli-contract.md",
  "templates/docs/HARNESS.md",
  "templates/AGENTS.md",
];

const PHANTOM_CLI = [
  /harness\s+score-context\b/,
  /harness\s+intervention\s+add\b/,
  /harness\s+query\s+interventions\b/,
  /harness\s+query\s+friction\b/,
];

describe("CLI contract docs (US-069 / decision 0023)", () => {
  it("does not advertise unimplemented CLI commands as live procedure", () => {
    for (const rel of POLICY_DOCS) {
      const text = read(rel);
      for (const pattern of PHANTOM_CLI) {
        expect(text, `${rel} must not present ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("does not tell agents to use cargo test or a Rust CLI", () => {
    const harness = read("docs/HARNESS.md");
    expect(harness).not.toMatch(/cargo test --workspace/);
    expect(harness).not.toMatch(/The Rust CLI/);
    expect(harness).not.toMatch(/No validation scripts exist yet/);
  });

  it("CHANGELOG records the current package version", () => {
    const changelog = read("CHANGELOG.md");
    expect(changelog).toMatch(new RegExp(`## \\[${VERSION.replaceAll(".", "\\.")}\\]`));
  });
});
