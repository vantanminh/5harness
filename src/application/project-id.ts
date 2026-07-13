import { resolveTargetDir } from "../domain/paths.js";
import {
  ensureProjectId,
  readProjectId,
} from "../infrastructure/project-id.js";
import {
  detectProjectName,
  type RegistryIoOptions,
} from "../infrastructure/registry.js";
import { linkProject } from "./registry.js";

export type ProjectIdentity = {
  id: string;
  path: string;
  name: string;
  created: boolean;
};

export function getProjectIdentity(
  pathInput: string | undefined,
  options: RegistryIoOptions & { cwd?: string; ensure?: boolean } = {},
): ProjectIdentity {
  const projectRoot = resolveTargetDir(pathInput, options.cwd ?? process.cwd());
  const identity = options.ensure
    ? ensureProjectId(projectRoot)
    : readProjectId(projectRoot);

  if (options.ensure) {
    linkProject(projectRoot, options);
  }

  return {
    id: identity.id,
    path: projectRoot,
    name: detectProjectName(projectRoot),
    created: identity.created,
  };
}
