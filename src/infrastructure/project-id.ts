import fs from "node:fs";
import path from "node:path";
import {
  extractProjectId,
  generateProjectId,
  insertProjectIdMarker,
} from "../domain/project-id.js";
import { atomicWriteFile } from "./atomic-write.js";

export type ProjectIdResult = {
  id: string;
  path: string;
  created: boolean;
};

export function projectAgentsPath(projectRoot: string): string {
  return path.join(projectRoot, "AGENTS.md");
}

export function hasProjectAgents(projectRoot: string): boolean {
  return fs.existsSync(projectAgentsPath(projectRoot));
}

export function readProjectId(projectRoot: string): ProjectIdResult {
  const agentsPath = projectAgentsPath(projectRoot);
  if (!fs.existsSync(agentsPath)) {
    throw new Error(
      `AGENTS.md not found in ${projectRoot}. Run \`harness init\` first.`,
    );
  }
  const id = extractProjectId(fs.readFileSync(agentsPath, "utf8"));
  if (!id) {
    throw new Error(
      "No harness project id in AGENTS.md. Run `harness project id --ensure`.",
    );
  }
  return { id, path: agentsPath, created: false };
}

export function ensureProjectId(
  projectRoot: string,
  preferredId?: string,
): ProjectIdResult {
  const agentsPath = projectAgentsPath(projectRoot);
  if (!fs.existsSync(agentsPath)) {
    throw new Error(
      `AGENTS.md not found in ${projectRoot}. Run \`harness init\` first.`,
    );
  }
  const current = fs.readFileSync(agentsPath, "utf8");
  const existing = extractProjectId(current);
  if (existing) {
    return { id: existing, path: agentsPath, created: false };
  }

  const id = preferredId ?? generateProjectId();
  atomicWriteFile(agentsPath, insertProjectIdMarker(current, id));
  return { id, path: agentsPath, created: true };
}
