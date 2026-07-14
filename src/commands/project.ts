import { getProjectIdentity } from "../application/project-id.js";
import {
  configureProjectPeer,
  configureProjectRole,
  getProjectRole,
  listProjectPeers,
  removeProjectPeer,
} from "../application/project-link.js";
import { formatTable } from "../infrastructure/table.js";

export type ProjectIdCliOptions = {
  dir?: string;
  directory?: string;
  ensure?: boolean;
  json?: boolean;
};

export function executeProjectId(options: ProjectIdCliOptions = {}): void {
  const pathInput = options.dir ?? options.directory;
  const project = getProjectIdentity(pathInput, { ensure: options.ensure });
  if (options.json) {
    console.log(
      JSON.stringify({ id: project.id, path: project.path, name: project.name }),
    );
    return;
  }
  console.log(project.id);
}

export type ProjectRoleCliOptions = {
  dir?: string;
  directory?: string;
  stack?: string;
  json?: boolean;
};

export function executeProjectRoleSet(
  role: string,
  options: ProjectRoleCliOptions = {},
): void {
  const pathInput = options.dir ?? options.directory;
  const result = configureProjectRole(role, options.stack, pathInput);
  if (options.json) {
    console.log(JSON.stringify({ role: result.role, stack: result.stack }));
    return;
  }
  console.log(
    `${result.modified ? "Set" : "Kept"} project role: ${result.role}`,
  );
  console.log(
    `Stack: ${result.stack.length > 0 ? result.stack.join(", ") : "none"}`,
  );
}

export function executeProjectRoleShow(
  options: ProjectRoleCliOptions = {},
): void {
  const pathInput = options.dir ?? options.directory;
  const result = getProjectRole(pathInput);
  if (options.json) {
    console.log(JSON.stringify({ role: result.role, stack: result.stack }));
    return;
  }
  console.log(`Project role: ${result.role ?? "not set"}`);
  console.log(
    `Stack: ${result.stack.length > 0 ? result.stack.join(", ") : "none"}`,
  );
}

export type ProjectPeerCliOptions = {
  dir?: string;
  directory?: string;
  role?: string;
  json?: boolean;
};

export function executeProjectPeerAdd(
  idOrPath: string,
  options: ProjectPeerCliOptions = {},
): void {
  const pathInput = options.dir ?? options.directory;
  const result = configureProjectPeer(
    idOrPath,
    options.role,
    pathInput,
  );
  console.log(`${result.modified ? "Added" : "Updated"} project peer:`);
  console.log(`  id:   ${result.peer.id}`);
  console.log(`  role: ${result.peer.role}`);
  console.log(`  name: ${result.peer.name ?? "unresolved"}`);
  console.log(`  path: ${result.peer.path ?? "unresolved"}`);
  if (result.warning) console.warn(`warning: ${result.warning}`);
}

export function executeProjectPeerRemove(
  projectId: string,
  options: ProjectPeerCliOptions = {},
): void {
  const pathInput = options.dir ?? options.directory;
  const result = removeProjectPeer(projectId, pathInput);
  console.log(
    result.modified
      ? `Removed project peer: ${result.peer.id}`
      : `No configured project peer: ${result.peer.id}`,
  );
  if (result.warning) console.warn(`warning: ${result.warning}`);
}

export function executeProjectPeerList(
  options: ProjectPeerCliOptions = {},
): void {
  const pathInput = options.dir ?? options.directory;
  const peers = listProjectPeers(pathInput);
  if (options.json) {
    console.log(JSON.stringify(peers));
    return;
  }
  if (peers.length === 0) {
    console.log("No project peers configured.");
    console.log("Use `harness project peer add <project-id-or-path>`.");
    return;
  }
  console.log(
    formatTable(
      peers.map((peer) => ({
        id: peer.id,
        role: peer.role,
        name: peer.name ?? "",
        path: peer.path ?? "unresolved",
        status: peer.resolved ? "ok" : "unresolved",
      })),
      ["id", "role", "name", "path", "status"],
    ),
  );
  const unresolved = peers.filter((peer) => !peer.resolved);
  for (const peer of unresolved) {
    console.log(`warning: ${peer.id}: ${peer.reason ?? "unresolved"}`);
  }
}
