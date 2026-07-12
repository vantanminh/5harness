import fs from "node:fs";
import path from "node:path";
import {
  classifyFilePlan,
  hasBlockingConflicts,
  type PlannedWrite,
} from "../domain/conflicts.js";
import { ENTITY_DIRS } from "../domain/entities.js";
import {
  PROJECT_STATE_DIRNAME,
  SQLITE_DB_BASENAME,
  projectBackupRoot,
  resolveDbPath,
  resolveTargetDir,
} from "../domain/paths.js";
import { linkProject } from "../application/registry.js";
import { ensureEntityDirs } from "./entities.js";
import { migrateDatabase } from "./db.js";

export type Manifest = {
  files: string[];
};

export const GITIGNORE_RULES = [
  "# 5harness local / derived (not SoT)",
  `${PROJECT_STATE_DIRNAME}/index/`,
  `${PROJECT_STATE_DIRNAME}/local/`,
  "# Optional SQLite import residue (not SoT)",
  SQLITE_DB_BASENAME,
  `${SQLITE_DB_BASENAME}-wal`,
  `${SQLITE_DB_BASENAME}-shm`,
] as const;

export type InitOptions = {
  directory?: string;
  force?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  packageRoot: string;
  log?: (message: string) => void;
  /** Skip global registry registration (tests). */
  skipRegister?: boolean;
  /** Skip creating legacy harness.db (default true since US-013). */
  skipDb?: boolean;
  /** Explicitly create legacy harness.db (transition/import only). */
  createLegacyDb?: boolean;
};

export type InitResult = {
  targetDir: string;
  dbPath: string;
  plans: PlannedWrite[];
  created: string[];
  overwritten: string[];
  skipped: string[];
  dryRun: boolean;
  schemaVersion: number;
  registered: boolean;
  registryPath?: string;
};

function loadManifest(packageRoot: string): Manifest {
  const manifestPath = path.join(packageRoot, "templates", "manifest.json");
  const raw = fs.readFileSync(manifestPath, "utf8");
  const parsed = JSON.parse(raw) as Manifest;
  if (!Array.isArray(parsed.files) || parsed.files.length === 0) {
    throw new Error("templates/manifest.json must list at least one file");
  }
  return parsed;
}

function planGitignore(targetDir: string): PlannedWrite {
  const gitignorePath = path.join(targetDir, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    return { kind: "gitignore", action: "create" };
  }
  const existing = fs.readFileSync(gitignorePath, "utf8");
  const missing = GITIGNORE_RULES.filter((rule) => !existing.includes(rule));
  if (missing.length === 0) {
    return { kind: "gitignore", action: "skip" };
  }
  return { kind: "gitignore", action: "append" };
}

function backupFile(targetDir: string, relative: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupRoot = projectBackupRoot(targetDir, stamp);
  const dest = path.join(backupRoot, relative);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(path.join(targetDir, relative), dest);
  return path.relative(targetDir, dest).replace(/\\/g, "/");
}

function writeTemplateFile(
  packageRoot: string,
  targetDir: string,
  relative: string,
): void {
  const source = path.join(packageRoot, "templates", relative);
  if (!fs.existsSync(source)) {
    throw new Error(`Template missing: ${relative}`);
  }
  const dest = path.join(targetDir, relative);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(source, dest);
}

function applyGitignore(targetDir: string, plan: PlannedWrite): void {
  if (plan.kind !== "gitignore") return;
  if (plan.action === "skip") return;
  const gitignorePath = path.join(targetDir, ".gitignore");
  if (plan.action === "create") {
    fs.writeFileSync(
      gitignorePath,
      `${GITIGNORE_RULES.join("\n")}\n`,
      "utf8",
    );
    return;
  }
  const existing = fs.readFileSync(gitignorePath, "utf8");
  const missing = GITIGNORE_RULES.filter((rule) => !existing.includes(rule));
  const prefix =
    existing.length > 0 && !existing.endsWith("\n") ? "\n" : existing ? "" : "";
  const sep = existing.length > 0 ? "\n" : "";
  fs.appendFileSync(
    gitignorePath,
    `${prefix}${sep}${missing.join("\n")}\n`,
    "utf8",
  );
}

function writeEntityDirReadmes(targetDir: string): void {
  const readmes: Record<string, string> = {
    [ENTITY_DIRS.story]:
      "# Stories\n\nOperational story entities (`US-*.md`) are managed via `harness story`.\n",
    [ENTITY_DIRS.decision]:
      "# Decisions\n\nDecision entities are managed via `harness decision`.\n",
    [ENTITY_DIRS.intake]:
      "# Intakes\n\nIntake entities (`IN-*.md`) are managed via `harness intake`.\n",
    [ENTITY_DIRS.backlog]:
      "# Backlog\n\nBacklog entities (`BL-*.md`) are managed via `harness backlog`.\n",
  };
  for (const [rel, content] of Object.entries(readmes)) {
    const dir = path.join(targetDir, rel);
    fs.mkdirSync(dir, { recursive: true });
    const readme = path.join(dir, "README.md");
    if (!fs.existsSync(readme)) {
      fs.writeFileSync(readme, content, "utf8");
    }
  }
}

export function runInit(options: InitOptions): InitResult {
  const log = options.log ?? (() => undefined);
  const cwd = options.cwd ?? process.cwd();
  const env = options.env ?? process.env;
  const force = Boolean(options.force);
  const dryRun = Boolean(options.dryRun);
  // US-013: default is no project SQLite SoT; opt-in via skipDb: false or createLegacyDb
  const skipDb = options.skipDb !== false && !options.createLegacyDb;
  const targetDir = resolveTargetDir(options.directory, cwd);
  const dbPath = resolveDbPath(targetDir, env);
  const migrationsDir = path.join(options.packageRoot, "migrations");
  const manifest = loadManifest(options.packageRoot);

  const plans: PlannedWrite[] = [];
  for (const relative of manifest.files) {
    plans.push(classifyFilePlan(targetDir, relative, force));
  }
  plans.push(planGitignore(targetDir));
  if (!skipDb) {
    plans.push({
      kind: "db",
      action: fs.existsSync(dbPath) ? "migrate" : "create",
      path: dbPath,
    });
  }

  const blockers = hasBlockingConflicts(plans, force);
  if (blockers.length > 0) {
    const list = blockers.join(", ");
    throw new Error(
      `Refusing to overwrite protected paths without --force: ${list}`,
    );
  }

  const created: string[] = [];
  const overwritten: string[] = [];
  const skipped: string[] = [];

  for (const plan of plans) {
    if (plan.kind === "create") {
      log(`create   ${plan.relative}`);
      if (!dryRun) {
        writeTemplateFile(options.packageRoot, targetDir, plan.relative);
      }
      created.push(plan.relative);
    } else if (plan.kind === "overwrite") {
      log(`overwrite ${plan.relative}`);
      if (!dryRun) {
        const backup = backupFile(targetDir, plan.relative);
        log(`  backup  ${backup}`);
        writeTemplateFile(options.packageRoot, targetDir, plan.relative);
      }
      overwritten.push(plan.relative);
    } else if (plan.kind === "skip") {
      log(`skip     ${plan.relative} (${plan.reason})`);
      skipped.push(plan.relative);
    } else if (plan.kind === "gitignore") {
      log(`gitignore ${plan.action}`);
      if (!dryRun) {
        applyGitignore(targetDir, plan);
      }
    } else if (plan.kind === "db") {
      log(`db       ${plan.action} ${plan.path}`);
    }
  }

  let schemaVersion = 0;
  let registered = false;
  let registryPath: string | undefined;

  if (!dryRun) {
    fs.mkdirSync(targetDir, { recursive: true });
    ensureEntityDirs(targetDir);
    writeEntityDirReadmes(targetDir);
    log("dirs     entity markdown directories ready");

    if (!skipDb) {
      const migrateResult = migrateDatabase(dbPath, migrationsDir);
      schemaVersion = migrateResult.currentVersion;
      for (const m of migrateResult.applied) {
        log(`migrate  v${m.version} ${m.name}`);
      }
      if (migrateResult.alreadyLatest) {
        log(`migrate  already at v${schemaVersion}`);
      }
    }

    if (!options.skipRegister) {
      try {
        const link = linkProject(targetDir, { env, cwd });
        registered = true;
        registryPath = link.registryPath;
        log(
          `register ${link.created ? "linked" : "updated"} → ${link.registryPath}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`register skipped (${msg})`);
      }
    }
  } else {
    log("dry-run  no files, database, or registry written");
    log("plan     would ensure entity dirs + register project");
  }

  return {
    targetDir,
    dbPath,
    plans,
    created,
    overwritten,
    skipped,
    dryRun,
    schemaVersion,
    registered,
    registryPath,
  };
}
