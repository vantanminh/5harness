import {
  hasMarkdownStore,
  writeProjectIndex,
} from "../application/index-store.js";

/**
 * Auto-reindex after a mutation command writes durable markdown.
 *
 * Decision 0012 (init auto-reindex) and US-015 extend this pattern to all
 * mutation commands so agents never need to call `harness reindex` manually.
 *
 * This is a best-effort call. If the markdown store does not exist or the
 * index build fails for any reason, the mutation command still succeeded —
 * the user just needs to run `harness reindex` by hand.
 */
export function maybeReindex(
  targetDir: string,
  log: (msg: string) => void = console.log,
): void {
  if (!hasMarkdownStore(targetDir)) return;
  try {
    const idx = writeProjectIndex(targetDir);
    log(
      `  reindex: ${idx.entities} entities, ${idx.edges} edges → ${idx.path}`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log(`  reindex: skipped (${msg})`);
  }
}
