import fs from "node:fs";
import {
  extractProjectRoleConfig,
  setProjectRoleMarkers,
  type ProjectRole,
  type ProjectRoleConfig,
} from "../domain/project-link.js";
import { atomicWriteFile } from "./atomic-write.js";
import { projectAgentsPath } from "./project-id.js";

export type ProjectRoleFileResult = ProjectRoleConfig & {
  path: string;
  modified: boolean;
};

function readAgents(projectRoot: string): { path: string; text: string } {
  const agentsPath = projectAgentsPath(projectRoot);
  if (!fs.existsSync(agentsPath)) {
    throw new Error(
      `AGENTS.md not found in ${projectRoot}. Run \`harness init\` first.`,
    );
  }
  return { path: agentsPath, text: fs.readFileSync(agentsPath, "utf8") };
}

export function readProjectRole(projectRoot: string): ProjectRoleFileResult {
  const agents = readAgents(projectRoot);
  return {
    ...extractProjectRoleConfig(agents.text),
    path: agents.path,
    modified: false,
  };
}

export function writeProjectRole(
  projectRoot: string,
  role: ProjectRole,
  stack: readonly string[],
): ProjectRoleFileResult {
  const agents = readAgents(projectRoot);
  const updated = setProjectRoleMarkers(agents.text, role, stack);
  const modified = updated !== agents.text;
  if (modified) atomicWriteFile(agents.path, updated);
  return { role, stack: [...stack], path: agents.path, modified };
}
