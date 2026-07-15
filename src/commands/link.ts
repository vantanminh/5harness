import {
  getRegistryFilePath,
  linkProject,
  listLinkedProjects,
  unlinkAllMissing,
  unlinkProject,
  unlinkProjectById,
} from "../application/registry.js";
import { formatTable } from "../infrastructure/table.js";
import { maybeReindex } from "./_reindex-helper.js";

export type LinkCliOptions = {
  dir?: string;
  directory?: string;
  id?: string;
  missing?: boolean;
};

export function executeLink(
  positionalPath: string | undefined,
  options: LinkCliOptions = {},
): void {
  const pathInput =
    options.dir ?? options.directory ?? positionalPath ?? undefined;
  const result = linkProject(pathInput);
  const action = result.created ? "Linked" : "Updated";
  console.log(`${action} project: ${result.entry.name}`);
  console.log(`  id:     ${result.entry.id}`);
  console.log(`  path:   ${result.entry.path}`);
  if (result.entry.remote) {
    console.log(`  remote: ${result.entry.remote}`);
  }
  console.log(`  registry: ${result.registryPath}`);

  // US-009 / US-015: reindex when markdown store is present
  maybeReindex(result.entry.path);
}

export function executeUnlink(
  positionalPath: string | undefined,
  options: LinkCliOptions = {},
): void {
  const pathInput =
    options.dir ?? options.directory ?? positionalPath ?? undefined;

  if (options.missing && (options.id || pathInput)) {
    throw new Error("--missing cannot be combined with --id or a directory.");
  }
  if (options.id && pathInput) {
    throw new Error("--id cannot be combined with a directory.");
  }

  if (options.missing) {
    const result = unlinkAllMissing();
    console.log(`Pruned ${result.count} missing project link(s).`);
    console.log(`Registry: ${result.registryPath}`);
    return;
  }

  if (options.id) {
    const projectId = options.id.trim();
    if (!projectId) {
      throw new Error("--id requires a non-empty project id.");
    }
    const result = unlinkProjectById(projectId);
    if (!result.removed) {
      console.log(`No registry entry for project id: ${projectId}`);
      console.log(`Registry: ${result.registryPath}`);
      return;
    }
    console.log(`Unlinked missing project: ${result.removed.name}`);
    console.log(`  id: ${result.removed.id}`);
    console.log(`  path: ${result.removed.path}`);
    console.log(`  registry: ${result.registryPath}`);
    return;
  }

  const result = unlinkProject(pathInput);
  if (!result.removed) {
    const resolved = pathInput ?? process.cwd();
    console.log(`No registry entry for: ${resolved}`);
    console.log(`Registry: ${result.registryPath}`);
    return;
  }
  console.log(`Unlinked project: ${result.removed.name}`);
  console.log(`  path: ${result.removed.path}`);
  console.log(`  registry: ${result.registryPath}`);
}

export function executeProjects(): void {
  const projects = listLinkedProjects();
  if (projects.length === 0) {
    console.log("No linked projects.");
    console.log(`Registry: ${getRegistryFilePath()}`);
    console.log("Use `harness link` in a project (or `harness link <path>`).");
    return;
  }
  const rows = projects.map((p) => ({
    id: p.id,
    name: p.name,
    path: p.path,
    linked_at: p.linked_at,
    remote: p.remote ?? "",
    status: p.missing ? "missing" : "ok",
  }));
  console.log(
    formatTable(rows, ["id", "name", "path", "status", "linked_at", "remote"]),
  );
  const missing = projects.filter((p) => p.missing).length;
  if (missing > 0) {
    console.log("");
    console.log(
      `warning: ${missing} project path(s) missing on disk (moved or deleted). Use \`harness unlink --id <id>\` or \`harness unlink --missing\`.`,
    );
  }
  console.log("");
  console.log(`Registry: ${getRegistryFilePath()}`);
}
