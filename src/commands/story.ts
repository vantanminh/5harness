import { addStory, updateStory } from "../application/durable.js";
import { withHarnessDb, type TargetOptions } from "../infrastructure/context.js";

export type StoryAddCliOptions = TargetOptions & {
  id: string;
  title: string;
  lane: string;
  contract?: string;
  verify?: string;
  notes?: string;
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
};

export function executeStoryAdd(options: StoryAddCliOptions): void {
  if (!options.id || !options.title || !options.lane) {
    throw new Error("story add requires --id, --title, and --lane");
  }
  withHarnessDb(options, (db) => {
    addStory(db, {
      id: options.id,
      title: options.title,
      lane: options.lane,
      contract: options.contract,
      verify: options.verify,
      notes: options.notes,
    });
  });
  console.log(`Story ${options.id} added.`);
}

export function executeStoryUpdate(options: StoryUpdateCliOptions): void {
  if (!options.id) {
    throw new Error("story update requires --id");
  }
  withHarnessDb(options, (db) => {
    updateStory(db, {
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
    });
  });
  console.log(`Story ${options.id} updated.`);
}
