import { describe, expect, it } from "vitest";
import {
  formatExportAssistSection,
  isUnreleasedEmpty,
  parseChangelogSections,
  promoteUnreleased,
} from "../src/application/changelog-hygiene.js";

const sample = `# Changelog

## [Unreleased]

### Added

- Feature X

### Fixed

- Bug Y

## [1.0.0] - 2026-01-01

### Added

- First release
`;

describe("parseChangelogSections", () => {
  it("parses Unreleased and version sections", () => {
    const sections = parseChangelogSections(sample);
    expect(sections.has("Unreleased")).toBe(true);
    expect(sections.has("1.0.0")).toBe(true);
    expect(sections.get("Unreleased")!.body).toContain("Feature X");
    expect(sections.get("1.0.0")!.body).toContain("First release");
  });
});

describe("isUnreleasedEmpty", () => {
  it("detects non-empty Unreleased", () => {
    expect(isUnreleasedEmpty(sample)).toBe(false);
  });

  it("detects empty Unreleased", () => {
    expect(
      isUnreleasedEmpty(`# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-01-01\n\n- x\n`),
    ).toBe(true);
  });
});

describe("promoteUnreleased", () => {
  it("moves Unreleased body under version heading", () => {
    const result = promoteUnreleased(sample, "1.1.0", "2026-07-12");
    expect(result.promoted).toBe(true);
    expect(result.alreadyVersioned).toBe(false);
    expect(result.body).toContain("Feature X");
    expect(result.text).toMatch(/## \[Unreleased\]\n\n## \[1\.1\.0\] - 2026-07-12/);
    expect(result.text).toContain("Feature X");
    expect(result.text).toContain("Bug Y");
    expect(result.text).toContain("## [1.0.0] - 2026-01-01");
    // Unreleased body cleared
    const sections = parseChangelogSections(result.text);
    expect(sections.get("Unreleased")!.body.trim()).toBe("");
    expect(sections.get("1.1.0")!.body).toContain("Feature X");
  });

  it("is a no-op when version section already exists", () => {
    const result = promoteUnreleased(sample, "1.0.0", "2026-07-12");
    expect(result.promoted).toBe(false);
    expect(result.alreadyVersioned).toBe(true);
    expect(result.text).toBe(sample);
  });

  it("is a no-op when Unreleased is empty", () => {
    const empty = `# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-01-01\n\n- x\n`;
    const result = promoteUnreleased(empty, "1.1.0", "2026-07-12");
    expect(result.promoted).toBe(false);
    expect(result.body).toBeNull();
  });

  it("handles CRLF input", () => {
    const crlf = sample.replace(/\n/g, "\r\n");
    const result = promoteUnreleased(crlf, "2.0.0", "2026-07-12");
    expect(result.promoted).toBe(true);
    expect(result.text).toContain("## [2.0.0] - 2026-07-12");
    expect(result.text).not.toContain("\r");
  });
});

describe("formatExportAssistSection", () => {
  it("formats story and decision bullets", () => {
    const md = formatExportAssistSection([
      { id: "US-038", title: "CHANGELOG discipline", type: "story" },
      { id: "0018", title: "CI provenance", type: "decision" },
    ]);
    expect(md).toContain("### From harness history (assist)");
    expect(md).toContain("[Story] US-038: CHANGELOG discipline");
    expect(md).toContain("[Decision] 0018: CI provenance");
  });

  it("returns empty string for no entries", () => {
    expect(formatExportAssistSection([])).toBe("");
  });
});
