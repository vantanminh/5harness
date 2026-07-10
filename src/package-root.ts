import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

/**
 * Resolve the installed package root (contains templates/ and migrations/).
 * Works for both `src/` (tsx) and `dist/` (compiled) entrypoints.
 */
export function resolvePackageRoot(fromUrl: string = import.meta.url): string {
  const here = path.dirname(fileURLToPath(fromUrl));
  const candidates = [
    path.resolve(here, ".."),
    path.resolve(here, "../.."),
    path.resolve(here),
  ];

  for (const candidate of candidates) {
    if (
      fs.existsSync(path.join(candidate, "templates", "manifest.json")) &&
      fs.existsSync(path.join(candidate, "migrations"))
    ) {
      return candidate;
    }
  }

  throw new Error(
    `Could not locate package root (templates/manifest.json) from ${here}`,
  );
}
