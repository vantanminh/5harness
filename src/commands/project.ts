import { getProjectIdentity } from "../application/project-id.js";
import {
  configureProjectRole,
  getProjectRole,
} from "../application/project-link.js";

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
