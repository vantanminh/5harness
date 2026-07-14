import { resolveTargetDir } from "../domain/paths.js";
import {
  parseProjectRole,
  parseProjectStack,
  type ProjectRoleConfig,
} from "../domain/project-link.js";
import {
  readProjectRole,
  writeProjectRole,
} from "../infrastructure/project-link.js";

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
