import { spawnSync } from "node:child_process";
import { VERSION } from "../version.js";
import {
  checkUpgradeAvailable,
  applyUpgrade,
} from "../application/upgrade.js";
import {
  resolveTargetFromOptions,
  type TargetOptions,
} from "../infrastructure/context.js";
import { resolvePackageRoot } from "../package-root.js";
import { maybeReindex } from "./_reindex-helper.js";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export function detectPackageManager(): PackageManager {
  const override = process.env.HARNESS_PM?.toLowerCase();
  if (
    override === "npm" ||
    override === "pnpm" ||
    override === "yarn" ||
    override === "bun"
  ) {
    return override;
  }

  const userAgent = process.env.npm_config_user_agent ?? "";
  if (userAgent.startsWith("pnpm/")) return "pnpm";
  if (userAgent.startsWith("yarn/")) return "yarn";
  if (userAgent.startsWith("bun/")) return "bun";
  if (userAgent.startsWith("npm/")) return "npm";

  const candidates: { name: PackageManager; cmd: string }[] = [
    { name: "pnpm", cmd: process.platform === "win32" ? "pnpm.cmd" : "pnpm" },
    { name: "yarn", cmd: process.platform === "win32" ? "yarn.cmd" : "yarn" },
    { name: "bun", cmd: process.platform === "win32" ? "bun.exe" : "bun" },
  ];
  for (const c of candidates) {
    const r = spawnSync(c.cmd, ["--version"], {
      stdio: "ignore",
      timeout: 5000,
    });
    if (r.status === 0) return c.name;
  }

  return "npm";
}

export function updateCommand(pm: PackageManager): { cmd: string; args: string[] } {
  switch (pm) {
    case "pnpm":
      return { cmd: "pnpm", args: ["add", "-g", "@vantanminh/harness@latest"] };
    case "yarn":
      return {
        cmd: "yarn",
        args: ["global", "add", "@vantanminh/harness@latest"],
      };
    case "bun":
      return {
        cmd: "bun",
        args: ["install", "-g", "@vantanminh/harness@latest"],
      };
    default:
      return {
        cmd: "npm",
        args: ["install", "-g", "@vantanminh/harness@latest"],
      };
  }
}

/**
 * Update the global npm package to latest.
 */
export function executeUpdate(): void {
  const pm = detectPackageManager();
  const { cmd, args } = updateCommand(pm);

  console.log(`Harness v${VERSION}`);
  console.log(`Detected package manager: ${pm}`);
  console.log(`Running: ${cmd} ${args.join(" ")}`);
  console.log("");

  // On Windows, shell: true is needed for .cmd/.bat wrappers (npm.cmd etc.).
  // With shell:true, passing a separate args array is deprecated (DEP0190)
  // because args are concatenated without proper escaping.
  // Instead, build a single command string when shell is active.
  const useShell = process.platform === "win32";
  const result = useShell
    ? spawnSync(`${cmd} ${args.join(" ")}`, [], {
        stdio: "inherit",
        shell: true,
      })
    : spawnSync(cmd, args, {
        stdio: "inherit",
      });

  if (result.error) {
    throw new Error(
      `Failed to run ${cmd}: ${result.error.message}. Install manually: ${cmd} ${args.join(" ")}`,
    );
  }
  if (result.status !== null && result.status !== 0) {
    throw new Error(
      `${cmd} exited with code ${result.status}. Try manually: ${cmd} ${args.join(" ")}`,
    );
  }
}

/**
 * Upgrade the harness block in the current project's AGENTS.md.
 *
 * Only replaces content between `<!-- HARNESS:BEGIN -->` and
 * `<!-- HARNESS:END -->`. User content outside the block is preserved.
 */
export function executeRepoUpgrade(options: TargetOptions = {}): void {
  const { targetDir } = resolveTargetFromOptions(options);
  const packageRoot = resolvePackageRoot();

  const check = checkUpgradeAvailable(targetDir, packageRoot);

  if (!check.repoVersion) {
    console.log("No harness version found in AGENTS.md.");
    console.log("This repo may have been initialized with an older harness.");
    console.log("Run `harness init --force` to re-scaffold (with backup).");
    return;
  }

  if (!check.available) {
    console.log(
      `Harness block is up-to-date (repo v${check.repoVersion}, CLI v${check.cliVersion}).`,
    );
    return;
  }

  console.log(
    `Repo harness version: ${check.repoVersion} → ${check.cliVersion}`,
  );
  console.log(
    "Upgrading harness block in AGENTS.md (HARNESS:BEGIN/END section only)...",
  );

  const result = applyUpgrade(targetDir, packageRoot);

  if (!result.modified) {
    console.log("No changes needed — harness block already matches.");
    return;
  }

  console.log(`  updated: AGENTS.md`);
  if (result.backupPath) {
    console.log(`  backup: ${result.backupPath}`);
  }
  console.log(
    `  repo harness block upgraded: v${result.repoVersion} → v${result.cliVersion}`,
  );

  // Auto-reindex after upgrade so any new template changes are indexed
  maybeReindex(targetDir);
}

