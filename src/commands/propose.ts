import {
  formatProposals,
  proposeFromDb,
} from "../application/propose.js";
import { withHarnessDb, type TargetOptions } from "../infrastructure/context.js";

export type ProposeCliOptions = TargetOptions & {
  commit?: boolean;
};

export function executePropose(options: ProposeCliOptions): void {
  const { proposals, committed } = withHarnessDb(options, (db) =>
    proposeFromDb(db, { commit: Boolean(options.commit) }),
  );
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
