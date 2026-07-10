import fs from "node:fs";
import path from "node:path";
import {
  parseFrontmatter,
  serializeEntityFile,
  type FrontmatterData,
} from "../domain/frontmatter.js";
import {
  ENTITY_DIRS,
  entityRelativePath,
  type EntityType,
} from "../domain/entities.js";

export type EntityFile = {
  absolutePath: string;
  relativePath: string;
  data: FrontmatterData;
  body: string;
};

export function ensureEntityDirs(projectRoot: string): void {
  for (const dir of Object.values(ENTITY_DIRS)) {
    fs.mkdirSync(path.join(projectRoot, dir), { recursive: true });
  }
}

export function resolveEntityAbsolute(
  projectRoot: string,
  relativePath: string,
): string {
  return path.resolve(projectRoot, relativePath);
}

export function readEntityFile(
  projectRoot: string,
  relativePath: string,
): EntityFile | null {
  const absolutePath = resolveEntityAbsolute(projectRoot, relativePath);
  if (!fs.existsSync(absolutePath)) return null;
  const content = fs.readFileSync(absolutePath, "utf8");
  const { data, body } = parseFrontmatter(content);
  return { absolutePath, relativePath, data, body };
}

export function readEntityById(
  projectRoot: string,
  type: EntityType,
  id: string,
): EntityFile | null {
  const relativePath = entityRelativePath(type, id);
  return readEntityFile(projectRoot, relativePath);
}

/**
 * Atomic write: temp sibling then rename.
 */
export function writeEntityFile(
  projectRoot: string,
  relativePath: string,
  data: FrontmatterData,
  body: string = "",
): EntityFile {
  const absolutePath = resolveEntityAbsolute(projectRoot, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  const content = serializeEntityFile(data, body);
  const tmp = `${absolutePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, "utf8");
  fs.renameSync(tmp, absolutePath);
  return { absolutePath, relativePath, data, body };
}

export function listEntityFiles(
  projectRoot: string,
  type: EntityType,
): EntityFile[] {
  const dir = path.join(projectRoot, ENTITY_DIRS[type]);
  if (!fs.existsSync(dir)) return [];
  const names = fs
    .readdirSync(dir)
    .filter((n) => n.endsWith(".md") && n.toLowerCase() !== "readme.md")
    .sort();
  const out: EntityFile[] = [];
  for (const name of names) {
    const relativePath = path.posix.join(ENTITY_DIRS[type], name);
    const file = readEntityFile(projectRoot, relativePath);
    if (!file) continue;
    // Skip non-entity docs that share the directory (e.g. backlog.md index).
    if (file.data.type !== undefined && file.data.type !== type) continue;
    if (file.data.type === undefined && !file.data.id) continue;
    out.push(file);
  }
  return out;
}

export function nextNumericEntityId(
  projectRoot: string,
  type: EntityType,
  prefix: string,
): string {
  const files = listEntityFiles(projectRoot, type);
  let max = 0;
  const re = new RegExp(`^${prefix}(\\d+)$`, "i");
  for (const f of files) {
    const id = String(f.data.id ?? path.basename(f.relativePath, ".md"));
    const m = id.match(re);
    if (m) {
      max = Math.max(max, Number(m[1]));
    }
  }
  const n = max + 1;
  return `${prefix}${String(n).padStart(3, "0")}`;
}
