import {
  addStoryMd,
  updateStoryMd,
} from "../application/md-durable.js";
import {
  withOptionalHarnessDb,
  type TargetOptions,
} from "../infrastructure/context.js";

export type StoryAddCliOptions = TargetOptions & {
  id: string;
  title: string;
  lane: string;
  contract?: string;
  verify?: string;
  notes?: string;
  links?: string;
};

export type StoryUpdateCliOptions = TargetOptions & {
  id: string;
  status?: string;
  evidence?: string;
  unit?: string;
  integration?: string;
  e2e?: string;
  platform?: string;
  verify?: string;
  title?: string;
  notes?: string;
  contract?: string;
  links?: string;
};

export function executeStoryAdd(options: StoryAddCliOptions): void {
  if (!options.id || !options.title || !options.lane) {
    throw new Error("story add requires --id, --title, and --lane");
  }
  const file = withOptionalHarnessDb(options, (db, { targetDir }) =>
    addStoryMd(
      { projectRoot: targetDir, db },
      {
        id: options.id,
        title: options.title,
        lane: options.lane,
        contract: options.contract,
        verify: options.verify,
        notes: options.notes,
        links: options.links,
      },
    ),
  );
  console.log(`Story ${options.id} added.`);
  console.log(`  file: ${file.relativePath}`);
}

export function executeStoryUpdate(options: StoryUpdateCliOptions): void {
  if (!options.id) {
    throw new Error("story update requires --id");
  }
  const file = withOptionalHarnessDb(options, (db, { targetDir }) =>
    updateStoryMd(
      { projectRoot: targetDir, db },
      {
        id: options.id,
        status: options.status,
        evidence: options.evidence,
        unit: options.unit,
        integration: options.integration,
        e2e: options.e2e,
        platform: options.platform,
        verify: options.verify,
        title: options.title,
        notes: options.notes,
        contract: options.contract,
        links: options.links,
      },
    ),
  );
  console.log(`Story ${options.id} updated.`);
  console.log(`  file: ${file.relativePath}`);
}
