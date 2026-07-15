import { createHash } from "node:crypto";
import path from "node:path";

export const REGISTRY_VERSION = 1 as const;

export type RegistryProject = {
  id: string;
  path: string;
  name: string;
  linked_at: string;
  updated_at: string;
  remote: string | null;
};

export type ProjectRegistry = {
  version: typeof REGISTRY_VERSION;
  projects: RegistryProject[];
};

export type ListedProject = RegistryProject & {
  missing: boolean;
};

export function emptyRegistry(): ProjectRegistry {
  return { version: REGISTRY_VERSION, projects: [] };
}

/** Stable id from absolute path (portable across re-links of same path). */
export function projectIdFromPath(absolutePath: string): string {
  const normalized = normalizeProjectPath(absolutePath);
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16);
}

export function normalizeProjectPath(absolutePath: string): string {
  // path.resolve already normalizes; lower-case drive letter on Windows for id stability
  const resolved = path.resolve(absolutePath);
  if (process.platform === "win32" && /^[A-Za-z]:/.test(resolved)) {
    return resolved[0]!.toUpperCase() + resolved.slice(1);
  }
  return resolved;
}

export function defaultProjectName(absolutePath: string): string {
  const base = path.basename(normalizeProjectPath(absolutePath));
  return base || absolutePath;
}

export function pathsEqual(a: string, b: string): boolean {
  const na = normalizeProjectPath(a);
  const nb = normalizeProjectPath(b);
  if (process.platform === "win32") {
    return na.toLowerCase() === nb.toLowerCase();
  }
  return na === nb;
}

export function findProjectByPath(
  registry: ProjectRegistry,
  absolutePath: string,
): RegistryProject | undefined {
  return registry.projects.find((p) => pathsEqual(p.path, absolutePath));
}

export function findProjectById(
  registry: ProjectRegistry,
  projectId: string,
): RegistryProject | undefined {
  return registry.projects.find((project) => project.id === projectId);
}

export function upsertProject(
  registry: ProjectRegistry,
  entry: Omit<RegistryProject, "id" | "linked_at" | "updated_at"> & {
    id?: string;
    linked_at?: string;
    updated_at?: string;
  },
  now: string = new Date().toISOString(),
): { registry: ProjectRegistry; entry: RegistryProject; created: boolean } {
  const absolutePath = normalizeProjectPath(entry.path);
  const existingByPath = findProjectByPath(registry, absolutePath);
  const existingById = entry.id
    ? registry.projects.find((project) => project.id === entry.id)
    : undefined;
  if (
    existingByPath &&
    existingById &&
    existingByPath.id !== existingById.id
  ) {
    throw new Error(
      `Registry conflict: ${absolutePath} and project id ${entry.id} identify different entries.`,
    );
  }
  const existing = existingByPath ?? existingById;
  if (existing) {
    const updated: RegistryProject = {
      ...existing,
      id: entry.id ?? existing.id,
      path: absolutePath,
      name: entry.name || existing.name,
      remote: entry.remote ?? existing.remote,
      updated_at: now,
    };
    const projects = registry.projects.map((p) =>
      p.id === existing.id ? updated : p,
    );
    return {
      registry: { ...registry, projects },
      entry: updated,
      created: false,
    };
  }

  const created: RegistryProject = {
    id: entry.id ?? projectIdFromPath(absolutePath),
    path: absolutePath,
    name: entry.name || defaultProjectName(absolutePath),
    linked_at: entry.linked_at ?? now,
    updated_at: entry.updated_at ?? now,
    remote: entry.remote ?? null,
  };
  return {
    registry: {
      ...registry,
      projects: [...registry.projects, created],
    },
    entry: created,
    created: true,
  };
}

export function removeProjectByPath(
  registry: ProjectRegistry,
  absolutePath: string,
): { registry: ProjectRegistry; removed: RegistryProject | undefined } {
  const existing = findProjectByPath(registry, absolutePath);
  if (!existing) {
    return { registry, removed: undefined };
  }
  return {
    registry: {
      ...registry,
      projects: registry.projects.filter((p) => p.id !== existing.id),
    },
    removed: existing,
  };
}

export function removeProjectById(
  registry: ProjectRegistry,
  projectId: string,
): { registry: ProjectRegistry; removed: RegistryProject | undefined } {
  const existing = findProjectById(registry, projectId);
  if (!existing) {
    return { registry, removed: undefined };
  }
  return {
    registry: {
      ...registry,
      projects: registry.projects.filter((p) => p.id !== projectId),
    },
    removed: existing,
  };
}

export function parseRegistryJson(raw: string): ProjectRegistry {
  const data = JSON.parse(raw) as Partial<ProjectRegistry>;
  if (!data || typeof data !== "object") {
    throw new Error("Invalid registry: expected object");
  }
  const version = data.version ?? REGISTRY_VERSION;
  if (version !== REGISTRY_VERSION) {
    throw new Error(
      `Unsupported registry version ${String(version)} (expected ${REGISTRY_VERSION})`,
    );
  }
  const projects = Array.isArray(data.projects) ? data.projects : [];
  const normalized: RegistryProject[] = projects.map((p, i) => {
    if (!p || typeof p !== "object") {
      throw new Error(`Invalid registry project at index ${i}`);
    }
    const row = p as Partial<RegistryProject>;
    if (!row.path || typeof row.path !== "string") {
      throw new Error(`Invalid registry project path at index ${i}`);
    }
    const absolutePath = normalizeProjectPath(row.path);
    return {
      id:
        typeof row.id === "string" && row.id
          ? row.id
          : projectIdFromPath(absolutePath),
      path: absolutePath,
      name:
        typeof row.name === "string" && row.name
          ? row.name
          : defaultProjectName(absolutePath),
      linked_at:
        typeof row.linked_at === "string" && row.linked_at
          ? row.linked_at
          : new Date(0).toISOString(),
      updated_at:
        typeof row.updated_at === "string" && row.updated_at
          ? row.updated_at
          : typeof row.linked_at === "string" && row.linked_at
            ? row.linked_at
            : new Date(0).toISOString(),
      remote: typeof row.remote === "string" ? row.remote : null,
    };
  });
  return { version: REGISTRY_VERSION, projects: normalized };
}
