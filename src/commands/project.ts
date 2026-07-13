import { getProjectIdentity } from "../application/project-id.js";

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
