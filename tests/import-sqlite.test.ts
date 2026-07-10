import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { addStory, addDecision, addIntake, addBacklog } from "../src/application/durable.js";
import { importSqliteToMarkdown } from "../src/application/import-sqlite.js";
import { queryMatrixMd } from "../src/application/md-query.js";
import { openExistingHarnessDb } from "../src/infrastructure/context.js";
import { runInit } from "../src/infrastructure/scaffold.js";
import { readEntityById } from "../src/infrastructure/entities.js";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("import-sqlite (US-013)", () => {
  it("imports rows to markdown without clobbering existing entities", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-import-"));
    tempDirs.push(dir);
    runInit({
      directory: dir,
      packageRoot,
      skipRegister: true,
      createLegacyDb: true,
    });
    const { db } = openExistingHarnessDb({ directory: dir, packageRoot });
    try {
      addStory(db, {
        id: "US-IMP",
        title: "Imported story",
        lane: "normal",
      });
      addDecision(db, {
        id: "D-IMP",
        title: "Imported decision",
      });
      addIntake(db, {
        type: "spec_slice",
        summary: "imported intake",
        lane: "tiny",
      });
      addBacklog(db, { title: "imported backlog", risk: "tiny" });
    } finally {
      db.close();
    }

    const result = importSqliteToMarkdown({
      projectRoot: dir,
      dbPath: path.join(dir, "harness.db"),
      migrationsDir: path.join(packageRoot, "migrations"),
    });
    expect(result.stories).toBe(1);
    expect(result.decisions).toBe(1);
    expect(result.intakes).toBe(1);
    expect(result.backlog).toBe(1);

    expect(readEntityById(dir, "story", "US-IMP")?.data.title).toBe(
      "Imported story",
    );
    expect(queryMatrixMd(dir)).toMatch(/US-IMP/);

    // second import without force skips
    const again = importSqliteToMarkdown({
      projectRoot: dir,
      dbPath: path.join(dir, "harness.db"),
      migrationsDir: path.join(packageRoot, "migrations"),
    });
    expect(again.skipped).toBeGreaterThan(0);
    expect(again.stories).toBe(0);
  });
});
