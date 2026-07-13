import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * US-037: public SECURITY.md + operational docs/SECURITY.md must encode
 * reporting, trust model, secrets, deps, and provenance guidance.
 */
describe("SECURITY policy docs (US-037)", () => {
  const rootSecurity = fs.readFileSync(path.join(root, "SECURITY.md"), "utf8");
  const docsSecurity = fs.readFileSync(
    path.join(root, "docs", "SECURITY.md"),
    "utf8",
  );
  const pkg = JSON.parse(
    fs.readFileSync(path.join(root, "package.json"), "utf8"),
  ) as { files?: string[]; publishConfig?: { provenance?: boolean } };

  it("root SECURITY.md has reporting and supported versions", () => {
    expect(rootSecurity).toMatch(/# Security Policy/i);
    expect(rootSecurity).toMatch(/Supported versions/i);
    expect(rootSecurity).toMatch(/Reporting a vulnerability/i);
    expect(rootSecurity).toMatch(/security\/advisories/i);
    expect(rootSecurity).toMatch(/docs\/SECURITY\.md/);
  });

  it("docs/SECURITY.md covers trust surfaces", () => {
    expect(docsSecurity).toMatch(/Verify commands/i);
    expect(docsSecurity).toMatch(/MCP/i);
    expect(docsSecurity).toMatch(/registry/i);
    expect(docsSecurity).toMatch(/Secrets/i);
    expect(docsSecurity).toMatch(/Dependency policy/i);
    expect(docsSecurity).toMatch(/Release provenance/i);
    expect(docsSecurity).toMatch(/127\.0\.0\.1|loopback/i);
  });

  it("package ships SECURITY.md; CI publishes with provenance", () => {
    expect(pkg.files).toContain("SECURITY.md");
    // Provenance is CI-only (OIDC). Do not set publishConfig.provenance —
    // local `npm publish` then fails with provider: null.
    const ci = fs.readFileSync(
      path.join(root, ".github", "workflows", "ci.yml"),
      "utf8",
    );
    expect(ci).toMatch(/npm publish[^\n]*--provenance/);
  });

  it("documents fail-closed MCP project grants", () => {
    expect(docsSecurity).toMatch(/single-project grant/i);
    expect(docsSecurity).toMatch(/all-projects grant/i);
    expect(docsSecurity).toMatch(/X-Harness-Project/);
    expect(docsSecurity).toMatch(/no cwd or first-linked fallback/i);
    expect(docsSecurity).toMatch(/not secrets or authentication credentials/i);
  });

  it("Dependabot is configured for npm and Actions", () => {
    const yml = fs.readFileSync(
      path.join(root, ".github", "dependabot.yml"),
      "utf8",
    );
    expect(yml).toMatch(/package-ecosystem:\s*npm/);
    expect(yml).toMatch(/package-ecosystem:\s*github-actions/);
  });
});
