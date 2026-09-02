/**
 * Resolve an entity id from a positional argument or `--id`.
 * Positional is canonical; `--id` is an agent-friendly alias.
 */
export function resolveEntityId(
  positional: string | undefined,
  optionId: string | undefined,
  command: string,
): string {
  const fromPos = positional?.trim() ?? "";
  const fromOpt = optionId?.trim() ?? "";
  if (fromPos && fromOpt && fromPos !== fromOpt) {
    throw new Error(
      `${command}: positional id (${fromPos}) and --id (${fromOpt}) disagree`,
    );
  }
  const id = fromPos || fromOpt;
  if (!id) {
    throw new Error(
      `${command} requires an entity id (positional <id> or --id <id>)`,
    );
  }
  return id;
}
