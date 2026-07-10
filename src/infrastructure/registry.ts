import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  defaultProjectName,
  emptyRegistry,
  parseRegistryJson,
  type ProjectRegistry,
  type RegistryProject,
} from "../domain/registry.js";
import {
  registryFilePath,
  resolveHarnessHome,
} from "../domain/paths.js";

export type RegistryIoOptions = {
  env?: NodeJS.ProcessEnv;
  harnessHome?: string;
};

export function getHarnessHome(options: RegistryIoOptions = {}): string {
  if (options.harnessHome) return path.resolve(options.harnessHome);
  return resolveHarnessHome(options.env ?? process.env);
}

export function getRegistryPath(options: RegistryIoOptions = {}): string {
  return registryFilePath(getHarnessHome(options));
}

export function readRegistry(options: RegistryIoOptions = {}): ProjectRegistry {
  const file = getRegistryPath(options);
  if (!fs.existsSync(file)) {
    return emptyRegistry();
  }
  const raw = fs.readFileSync(file, "utf8");
  if (!raw.trim()) {
    return emptyRegistry();
  }
  return parseRegistryJson(raw);
}

/**
 * Atomic write: temp file in same directory then rename.
 * Avoids partial JSON on crash; simple exclusive replace (not multi-writer lock).
 */
export function writeRegistry(
  registry: ProjectRegistry,
  options: RegistryIoOptions = {},
): string {
  const home = getHarnessHome(options);
  fs.mkdirSync(home, { recursive: true });
  const file = registryFilePath(home);
  const payload = `${JSON.stringify(registry, null, 2)}\n`;
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, payload, "utf8");
  fs.renameSync(tmp, file);
  return file;
}

export function detectProjectName(absolutePath: string): string {
  const pkgPath = path.join(absolutePath, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as {
        name?: string;
      };
      if (pkg.name && typeof pkg.name === "string") {
        return pkg.name;
      }
    } catch {
      // fall through
    }
  }
  return defaultProjectName(absolutePath);
}

export function detectGitRemote(absolutePath: string): string | null {
  const gitDir = path.join(absolutePath, ".git");
  if (!fs.existsSync(gitDir)) {
    return null;
  }
  try {
    const result = spawnSync(
      "git",
      ["-C", absolutePath, "config", "--get", "remote.origin.url"],
      { encoding: "utf8", windowsHide: true },
    );
    if (result.status === 0) {
      const url = result.stdout.trim();
      return url || null;
    }
  } catch {
    // git missing or failed
  }
  return null;
}

export function pathExists(absolutePath: string): boolean {
  try {
    return fs.statSync(absolutePath).isDirectory();
  } catch {
    return false;
  }
}

export function listProjectsWithStatus(
  registry: ProjectRegistry = readRegistry(),
): Array<RegistryProject & { missing: boolean }> {
  return registry.projects.map((p) => ({
    ...p,
    missing: !pathExists(p.path),
  }));
}
