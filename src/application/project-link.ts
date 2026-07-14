import { resolveTargetDir } from "../domain/paths.js";
import {
  parseProjectRole,
  parseProjectStack,
  type ProjectPeer,
  type ProjectRoleConfig,
} from "../domain/project-link.js";
import { parseProjectId } from "../domain/project-id.js";
import {
  findProjectById,
  findProjectByPath,
  type RegistryProject,
} from "../domain/registry.js";
import {
  deleteProjectPeer,
  readProjectLink,
  readProjectRole,
  writeProjectPeer,
  writeProjectRole,
} from "../infrastructure/project-link.js";
import { readProjectId } from "../infrastructure/project-id.js";
import {
  pathExists,
  readRegistry,
  type RegistryIoOptions,
} from "../infrastructure/registry.js";

export type ProjectRoleResult = ProjectRoleConfig & {
  projectRoot: string;
  modified: boolean;
};

export function getProjectRole(
  pathInput?: string,
  options: { cwd?: string } = {},
): ProjectRoleResult {
  const projectRoot = resolveTargetDir(pathInput, options.cwd ?? process.cwd());
  const result = readProjectRole(projectRoot);
  return {
    role: result.role,
    stack: result.stack,
    projectRoot,
    modified: false,
  };
}

export function configureProjectRole(
  roleInput: string,
  stackInput: string | undefined,
  pathInput?: string,
  options: { cwd?: string } = {},
): ProjectRoleResult {
  const projectRoot = resolveTargetDir(pathInput, options.cwd ?? process.cwd());
  const role = parseProjectRole(roleInput);
  const stack = parseProjectStack(stackInput);
  const result = writeProjectRole(projectRoot, role, stack);
  return { role, stack, projectRoot, modified: result.modified };
}

export type ResolvedRegistryProject = {
  id: string;
  name: string;
  path: string;
  entry: RegistryProject;
};

export type ListedProjectPeer = ProjectPeer & {
  name: string | null;
  path: string | null;
  resolved: boolean;
  reason: string | null;
};

export type ConfigureProjectPeerResult = {
  localProjectId: string;
  localProjectRoot: string;
  peer: ListedProjectPeer;
  modified: boolean;
  reverseModified: boolean;
  warning: string | null;
};

export type ProjectPeerSelector = {
  peerId?: string;
  role?: string;
};

export type ResolvedProjectPeer = ProjectPeer & {
  name: string;
  path: string;
  localProjectId: string;
  localProjectRoot: string;
};

function registryIo(options: RegistryIoOptions): RegistryIoOptions {
  return { env: options.env, harnessHome: options.harnessHome };
}

function verifyRegistryProject(entry: RegistryProject): ResolvedRegistryProject {
  if (!pathExists(entry.path)) {
    throw new Error(
      `Peer project ${entry.id} is linked but missing on disk at ${entry.path}.`,
    );
  }
  let durableId: string;
  try {
    durableId = readProjectId(entry.path).id;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Peer project ${entry.id} is not healthy: ${message}`);
  }
  if (durableId !== entry.id) {
    throw new Error(
      `Peer project ${entry.id} registry identity does not match AGENTS.md id ${durableId}. Run \`harness link\` in the peer project.`,
    );
  }
  return { id: entry.id, name: entry.name, path: entry.path, entry };
}

export function resolveRegisteredProject(
  idOrPath: string,
  options: RegistryIoOptions & { cwd?: string } = {},
): ResolvedRegistryProject {
  const input = idOrPath.trim();
  if (!input) throw new Error("Peer project id or path is required.");
  const registry = readRegistry(registryIo(options));
  const byId = findProjectById(registry, input);
  const pathInput = resolveTargetDir(input, options.cwd ?? process.cwd());
  const entry = byId ?? findProjectByPath(registry, pathInput);
  if (!entry) {
    throw new Error(
      `Peer project "${idOrPath}" is not linked on this machine. Run \`harness link\` in that project first.`,
    );
  }
  return verifyRegistryProject(entry);
}

function inspectPeer(
  peer: ProjectPeer,
  options: RegistryIoOptions,
): ListedProjectPeer {
  const registry = readRegistry(registryIo(options));
  const entry = findProjectById(registry, peer.id);
  if (!entry) {
    return {
      ...peer,
      name: null,
      path: null,
      resolved: false,
      reason: "not linked on this machine",
    };
  }
  try {
    const resolved = verifyRegistryProject(entry);
    return {
      ...peer,
      name: resolved.name,
      path: resolved.path,
      resolved: true,
      reason: null,
    };
  } catch (error) {
    return {
      ...peer,
      name: entry.name,
      path: null,
      resolved: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export function listProjectPeers(
  pathInput?: string,
  options: RegistryIoOptions & { cwd?: string } = {},
): ListedProjectPeer[] {
  const projectRoot = resolveTargetDir(pathInput, options.cwd ?? process.cwd());
  return readProjectLink(projectRoot).peers.map((peer) =>
    inspectPeer(peer, options),
  );
}

export function hasProjectPeers(projectRoot: string): boolean {
  return readProjectLink(projectRoot).peers.length > 0;
}

export function resolveProjectPeer(
  selector: ProjectPeerSelector,
  pathInput?: string,
  options: RegistryIoOptions & { cwd?: string } = {},
): ResolvedProjectPeer {
  if (selector.peerId && selector.role) {
    throw new Error("Choose either --peer/peer_id or --role, not both.");
  }
  if (!selector.peerId && !selector.role) {
    throw new Error("Select a configured peer with --peer/peer_id or --role.");
  }

  const localProjectRoot = resolveTargetDir(
    pathInput,
    options.cwd ?? process.cwd(),
  );
  const localProjectId = readProjectId(localProjectRoot).id;
  const peers = readProjectLink(localProjectRoot).peers;
  let peer: ProjectPeer | undefined;

  if (selector.peerId) {
    const peerId = parseProjectId(selector.peerId);
    peer = peers.find((candidate) => candidate.id === peerId);
    if (!peer) {
      throw new Error(
        `Project ${peerId} is not a configured peer of ${localProjectId}.`,
      );
    }
  } else {
    const role = parseProjectRole(selector.role ?? "");
    const matches = peers.filter((candidate) => candidate.role === role);
    if (matches.length === 0) {
      throw new Error(`No configured peer has role ${role}.`);
    }
    if (matches.length > 1) {
      throw new Error(
        `Peer role ${role} is ambiguous (${matches.length} configured peers). Use --peer/peer_id.`,
      );
    }
    peer = matches[0];
  }

  const resolved = resolveRegisteredProject(peer.id, options);
  return {
    ...peer,
    name: resolved.name,
    path: resolved.path,
    localProjectId,
    localProjectRoot,
  };
}

export function configureProjectPeer(
  peerInput: string,
  roleInput: string | undefined,
  pathInput?: string,
  options: RegistryIoOptions & { cwd?: string } = {},
): ConfigureProjectPeerResult {
  const localProjectRoot = resolveTargetDir(
    pathInput,
    options.cwd ?? process.cwd(),
  );
  const localProjectId = readProjectId(localProjectRoot).id;
  const localConfig = readProjectLink(localProjectRoot);
  const target = resolveRegisteredProject(peerInput, options);
  if (target.id === localProjectId) {
    throw new Error("A project cannot be linked to itself as a peer.");
  }

  const targetConfig = readProjectLink(target.path);
  const role = roleInput
    ? parseProjectRole(roleInput)
    : (targetConfig.role ?? "other");
  const written = writeProjectPeer(localProjectRoot, { id: target.id, role });

  let reverseModified = false;
  let warning: string | null = null;
  try {
    const reverse = writeProjectPeer(target.path, {
      id: localProjectId,
      role: localConfig.role ?? "other",
    });
    reverseModified = reverse.modified;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warning = `Forward peer link saved, but reverse link failed: ${message}`;
  }

  return {
    localProjectId,
    localProjectRoot,
    peer: inspectPeer({ id: target.id, role }, options),
    modified: written.modified,
    reverseModified,
    warning,
  };
}

export function removeProjectPeer(
  projectIdInput: string,
  pathInput?: string,
  options: RegistryIoOptions & { cwd?: string } = {},
): ConfigureProjectPeerResult {
  const projectId = parseProjectId(projectIdInput);
  const localProjectRoot = resolveTargetDir(
    pathInput,
    options.cwd ?? process.cwd(),
  );
  const localProjectId = readProjectId(localProjectRoot).id;
  const current = readProjectLink(localProjectRoot).peers.find(
    (peer) => peer.id === projectId,
  );
  const peer = current ?? { id: projectId, role: "other" as const };
  const removed = deleteProjectPeer(localProjectRoot, projectId);

  let reverseModified = false;
  let warning: string | null = null;
  if (removed.modified) {
    try {
      const target = resolveRegisteredProject(projectId, options);
      reverseModified = deleteProjectPeer(target.path, localProjectId).modified;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warning = `Local peer link removed, but reverse unlink failed: ${message}`;
    }
  }

  return {
    localProjectId,
    localProjectRoot,
    peer: inspectPeer(peer, options),
    modified: removed.modified,
    reverseModified,
    warning,
  };
}
