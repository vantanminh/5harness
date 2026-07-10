import { spawnSync } from "node:child_process";
import { VERSION } from "../version.js";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

export function detectPackageManager(): PackageManager {
  // Explicit override via env
  const override = process.env.HARNESS_PM?.toLowerCase();
  if (
    override === "npm" ||
    override === "pnpm" ||
    override === "yarn" ||
    override === "bun"
  ) {
    return override;
  }

  // npm/pnpm/yarn set npm_config_user_agent when running lifecycle scripts;
  // some shells also inherit it. Check for hints.
  const userAgent = process.env.npm_config_user_agent ?? "";
  if (userAgent.startsWith("pnpm/")) return "pnpm";
  if (userAgent.startsWith("yarn/")) return "yarn";
  if (userAgent.startsWith("bun/")) return "bun";
  if (userAgent.startsWith("npm/")) return "npm";

  // Probe PATH for known package managers (order: pnpm, yarn, bun, npm fallback)
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

export function executeUpdate(): void {
  const pm = detectPackageManager();
  const { cmd, args } = updateCommand(pm);

  console.log(`Harness v${VERSION}`);
  console.log(`Detected package manager: ${pm}`);
  console.log(`Running: ${cmd} ${args.join(" ")}`);
  console.log("");

  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
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
