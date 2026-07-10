import {
  formatProposals,
  proposeFromProject,
} from "../application/propose.js";
import {
  resolveTargetFromOptions,
  type TargetOptions,
} from "../infrastructure/context.js";

export type ProposeCliOptions = TargetOptions & {
  commit?: boolean;
};

export function executePropose(options: ProposeCliOptions): void {
  const { targetDir } = resolveTargetFromOptions(options);
  const { proposals, committed } = proposeFromProject(targetDir, {
    commit: Boolean(options.commit),
  });
  console.log(formatProposals(proposals));
  if (options.commit) {
    console.log("");
    console.log(
      committed === 0
        ? "Commit: no new backlog rows (empty or already proposed)."
        : `Commit: added ${committed} backlog item(s).`,
    );
  }
}
