import fs from "node:fs";
import path from "node:path";
import {
  resolveTargetFromOptions,
  type TargetOptions,
} from "../infrastructure/context.js";
import {
  buildProjectIndex,
  writeProjectIndex,
} from "../application/index-store.js";
import { ENTITY_DIRS } from "../domain/entities.js";

export type WatchCliOptions = TargetOptions;

export const WATCH_DIRS = [...new Set(Object.values(ENTITY_DIRS))];

export function executeWatch(options: WatchCliOptions): void {
  const { targetDir } = resolveTargetFromOptions(options);

  const dirsToWatch = WATCH_DIRS
    .map((d) => path.join(targetDir, d))
    .filter((d) => fs.existsSync(d));

  if (dirsToWatch.length === 0) {
    throw new Error(
      "No entity directories found. Run `harness init` first.",
    );
  }

  console.log(`Watching ${dirsToWatch.length} director${dirsToWatch.length === 1 ? "y" : "ies"} for entity changes...`);
  console.log("Press Ctrl+C to stop.\n");

  let timer: ReturnType<typeof setTimeout> | null = null;
  const DEBOUNCE_MS = 500;

  function scheduleReindex(reason: string, filePath: string): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        console.log(
          `[watch] Change detected: ${reason} — ${path.relative(targetDir, filePath)}`,
        );
        const index = buildProjectIndex(targetDir);
        const result = writeProjectIndex(targetDir, index);
        console.log(
          `[watch] Reindexed: ${result.entities} entities, ${result.edges} edges`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[watch] Reindex failed (non-fatal): ${msg}`);
      }
      timer = null;
    }, DEBOUNCE_MS);
  }

  const watchers: fs.FSWatcher[] = [];

  for (const dir of dirsToWatch) {
    try {
      const watcher = fs.watch(dir, { recursive: false }, (eventType, filename) => {
        if (!filename || !filename.endsWith(".md")) return;
        const fullPath = path.join(dir, filename);
        scheduleReindex(eventType, fullPath);
      });
      watchers.push(watcher);
      console.log(`  ${path.relative(targetDir, dir)}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[watch] Failed to watch ${path.relative(targetDir, dir)}: ${msg}`);
    }
  }

  // Graceful shutdown
  const cleanup = (): void => {
    console.log("\n[watch] Stopping...");
    if (timer) clearTimeout(timer);
    for (const w of watchers) {
      try { w.close(); } catch { /* ignore */ }
    }
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // Keep alive
  process.stdin.resume();
}
