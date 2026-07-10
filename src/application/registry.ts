import {
  removeProjectByPath,
  upsertProject,
  type ListedProject,
  type RegistryProject,
} from "../domain/registry.js";
import { resolveTargetDir } from "../domain/paths.js";
import {
  detectGitRemote,
  detectProjectName,
  getRegistryPath,
  listProjectsWithStatus,
  pathExists,
  readRegistry,
  writeRegistry,
  type RegistryIoOptions,
} from "../infrastructure/registry.js";

export type LinkResult = {
  entry: RegistryProject;
  created: boolean;
  registryPath: string;
};

export type UnlinkResult = {
  removed: RegistryProject | undefined;
  registryPath: string;
};

export function linkProject(
  pathInput: string | undefined,
  options: RegistryIoOptions & { cwd?: string } = {},
): LinkResult {
  const absolutePath = resolveTargetDir(pathInput, options.cwd ?? process.cwd());
  const io: RegistryIoOptions = {
    env: options.env,
    harnessHome: options.harnessHome,
  };

  if (!pathExists(absolutePath)) {
    throw new Error(
      `Project path does not exist or is not a directory: ${absolutePath}`,
    );
  }

  const registry = readRegistry(io);
  const name = detectProjectName(absolutePath);
  const remote = detectGitRemote(absolutePath);
  const { registry: next, entry, created } = upsertProject(registry, {
    path: absolutePath,
    name,
    remote,
  });
  const registryPath = writeRegistry(next, io);
  return { entry, created, registryPath };
}

export function unlinkProject(
  pathInput: string | undefined,
  options: RegistryIoOptions & { cwd?: string } = {},
): UnlinkResult {
  const absolutePath = resolveTargetDir(pathInput, options.cwd ?? process.cwd());
  const io: RegistryIoOptions = {
    env: options.env,
    harnessHome: options.harnessHome,
  };
  const registry = readRegistry(io);
  const { registry: next, removed } = removeProjectByPath(registry, absolutePath);
  const registryPath = writeRegistry(next, io);
  return { removed, registryPath };
}

export function listLinkedProjects(
  options: RegistryIoOptions = {},
): ListedProject[] {
  const registry = readRegistry(options);
  return listProjectsWithStatus(registry);
}

export function getRegistryFilePath(options: RegistryIoOptions = {}): string {
  return getRegistryPath(options);
}
