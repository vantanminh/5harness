#!/usr/bin/env node
import { Command } from "commander";
import { executeAudit } from "./commands/audit.js";
import { executeBacklogAdd, executeBacklogClose } from "./commands/backlog.js";
import { executeDecisionAdd } from "./commands/decision.js";
import { executeInit } from "./commands/init.js";
import { executeIntake } from "./commands/intake.js";
import {
  executeLink,
  executeProjects,
  executeUnlink,
} from "./commands/link.js";
import { executeMigrate } from "./commands/migrate.js";
import { executePropose } from "./commands/propose.js";
import { executeQuery } from "./commands/query.js";
import { executeStoryAdd, executeStoryUpdate } from "./commands/story.js";
import { executeScoreTrace, executeTrace } from "./commands/trace.js";
import {
  executeDecisionVerify,
  executeStoryVerify,
  executeStoryVerifyAll,
} from "./commands/verify.js";
import { VERSION } from "./version.js";

function fail(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`error: ${message}`);
  process.exit(1);
}

function withErrors(fn: () => void): void {
  try {
    fn();
  } catch (error) {
    fail(error);
  }
}

function addDirOptions(cmd: Command): Command {
  return cmd
    .option("-d, --dir <path>", "target project directory (default: cwd)")
    .option("--directory <path>", "alias for --dir");
}

function main(argv: string[] = process.argv): void {
  const program = new Command();

  program
    .name("harness")
    .description(
      "npm-native agent-ready repository harness — init, durable records, and queries",
    )
    .version(VERSION, "-V, --version", "print CLI version");

  addDirOptions(
    program
      .command("init")
      .description(
        "Scaffold Phase A operating files and create/migrate harness.db",
      )
      .argument("[directory]", "target project directory (default: cwd)")
      .option("-y, --yes", "non-interactive (reserved)")
      .option("--dry-run", "print planned operations without writing")
      .option(
        "--force",
        "overwrite conflicting files after backup under .harness-backup/",
      )
      .action((directory: string | undefined, opts) => {
        withErrors(() => executeInit(directory, opts));
      }),
  );

  addDirOptions(
    program
      .command("migrate")
      .description("Apply pending SQL migrations to the harness database")
      .argument("[directory]", "target project directory (default: cwd)")
      .action((directory: string | undefined, opts) => {
        withErrors(() => executeMigrate(directory, opts));
      }),
  );

  addDirOptions(
    program
      .command("link")
      .description(
        "Register a project path in the machine-local global registry",
      )
      .argument("[directory]", "project root (default: cwd)")
      .action((directory: string | undefined, opts) => {
        withErrors(() => executeLink(directory, opts));
      }),
  );

  addDirOptions(
    program
      .command("unlink")
      .description(
        "Remove a project from the global registry (does not delete files)",
      )
      .argument("[directory]", "project root (default: cwd)")
      .action((directory: string | undefined, opts) => {
        withErrors(() => executeUnlink(directory, opts));
      }),
  );

  program
    .command("projects")
    .description("List projects linked in the global registry")
    .action(() => {
      withErrors(() => executeProjects());
    });

  addDirOptions(
    program
      .command("intake")
      .description("Record a feature intake classification")
      .requiredOption("--type <type>", "input type (e.g. spec_slice, maintenance)")
      .requiredOption("--summary <text>", "short summary of the work")
      .requiredOption(
        "--lane <lane>",
        "risk lane: tiny | normal | high-risk",
      )
      .option("--flags <csv>", "risk flags")
      .option("--docs <csv>", "affected docs")
      .option("--story <id>", "linked story id")
      .option("--notes <text>", "notes")
      .option("--links <csv>", "related entity links (wikilink-style ids)")
      .action((opts) => {
        withErrors(() => executeIntake(opts));
      }),
  );

  const story = program
    .command("story")
    .description("Add or update a story matrix row");

  addDirOptions(
    story
      .command("add")
      .description("Add a story")
      .requiredOption("--id <id>", "story id (e.g. US-001)")
      .requiredOption("--title <text>", "story title")
      .requiredOption("--lane <lane>", "tiny | normal | high-risk")
      .option("--contract <path>", "product contract path")
      .option("--verify <command>", "verify command")
      .option("--notes <text>", "notes")
      .option("--links <csv>", "related entity links")
      .action((opts) => {
        withErrors(() => executeStoryAdd(opts));
      }),
  );

  addDirOptions(
    story
      .command("update")
      .description("Update a story (proof flags use 0|1)")
      .requiredOption("--id <id>", "story id")
      .option("--status <status>", "planned|in_progress|implemented|changed|retired")
      .option("--evidence <text>", "evidence summary")
      .option("--unit <0|1>", "unit proof flag")
      .option("--integration <0|1>", "integration proof flag")
      .option("--e2e <0|1>", "e2e proof flag")
      .option("--platform <0|1>", "platform proof flag")
      .option("--verify <command>", "verify command")
      .option("--title <text>", "title")
      .option("--contract <path>", "contract path")
      .option("--notes <text>", "notes")
      .option("--links <csv>", "related entity links")
      .action((opts) => {
        withErrors(() => executeStoryUpdate(opts));
      }),
  );

  addDirOptions(
    story
      .command("verify")
      .description("Run a story verify_command and record pass/fail")
      .argument("<id>", "story id")
      .action((id: string, opts) => {
        withErrors(() => executeStoryVerify(id, opts));
      }),
  );

  addDirOptions(
    story
      .command("verify-all")
      .description("Verify every story that has a verify_command")
      .action((opts) => {
        withErrors(() => executeStoryVerifyAll(opts));
      }),
  );

  const decision = program
    .command("decision")
    .description("Record a durable decision");

  addDirOptions(
    decision
      .command("add")
      .description("Add a decision")
      .requiredOption("--id <id>", "decision id")
      .requiredOption("--title <text>", "title")
      .option("--status <status>", "proposed|accepted|superseded|rejected", "accepted")
      .option("--doc <path>", "markdown decision path (default docs/decisions/<id>.md)")
      .option("--verify <command>", "optional verify command")
      .option("--notes <text>", "notes")
      .option("--links <csv>", "related entity links")
      .action((opts) => {
        withErrors(() => executeDecisionAdd(opts));
      }),
  );

  addDirOptions(
    decision
      .command("verify")
      .description("Run a decision verify_command and record pass/fail")
      .argument("<id>", "decision id")
      .action((id: string, opts) => {
        withErrors(() => executeDecisionVerify(id, opts));
      }),
  );

  const backlog = program
    .command("backlog")
    .description("Manage harness improvement backlog");

  addDirOptions(
    backlog
      .command("add")
      .description("Add a backlog item")
      .requiredOption("--title <text>", "title")
      .option("--while <text>", "discovered while")
      .option("--pain <text>", "current pain")
      .option("--suggestion <text>", "suggested improvement")
      .option("--risk <lane>", "tiny | normal | high-risk")
      .option("--predicted <text>", "predicted impact")
      .option("--notes <text>", "notes")
      .option("--links <csv>", "related entity links")
      .action((opts) => {
        withErrors(() => executeBacklogAdd(opts));
      }),
  );

  addDirOptions(
    backlog
      .command("close")
      .description("Close a backlog item")
      .requiredOption("--id <id>", "backlog id")
      .option("--status <status>", "implemented|rejected", "implemented")
      .option("--outcome <text>", "actual outcome")
      .action((opts) => {
        withErrors(() => executeBacklogClose(opts));
      }),
  );

  const query = program
    .command("query")
    .description("Query harness durable data");

  addDirOptions(
    query
      .command("matrix")
      .description("Story test matrix")
      .option("--numeric", "render proof flags as 1/0")
      .action((opts) => {
        withErrors(() => executeQuery("matrix", opts));
      }),
  );

  addDirOptions(
    query
      .command("stats")
      .description("Summary counts")
      .action((opts) => {
        withErrors(() => executeQuery("stats", opts));
      }),
  );

  addDirOptions(
    query
      .command("intakes")
      .description("Recent intake classifications")
      .action((opts) => {
        withErrors(() => executeQuery("intakes", opts));
      }),
  );

  addDirOptions(
    query
      .command("decisions")
      .description("Decision records")
      .action((opts) => {
        withErrors(() => executeQuery("decisions", opts));
      }),
  );

  addDirOptions(
    query
      .command("stories")
      .description("Story list")
      .action((opts) => {
        withErrors(() => executeQuery("stories", opts));
      }),
  );

  addDirOptions(
    query
      .command("backlog")
      .description("Backlog items")
      .option("--open", "only proposed/accepted")
      .option("--closed", "only implemented/rejected")
      .action((opts) => {
        withErrors(() => executeQuery("backlog", opts));
      }),
  );

  addDirOptions(
    query
      .command("traces")
      .description("Recent execution traces")
      .action((opts) => {
        withErrors(() => executeQuery("traces", opts));
      }),
  );

  addDirOptions(
    program
      .command("trace")
      .description("Record an agent execution trace")
      .requiredOption("--summary <text>", "task summary")
      .option(
        "--outcome <outcome>",
        "completed | blocked | partial | failed",
      )
      .option("--intake <id>", "linked intake id")
      .option("--story <id>", "linked story id")
      .option("--agent <name>", "agent name")
      .option("--duration <ms>", "duration in milliseconds")
      .option("--actions <text>", "actions taken")
      .option("--read <text>", "files read")
      .option("--changed <text>", "files changed")
      .option("--decisions <text>", "decisions made")
      .option("--errors <text>", "errors")
      .option("--friction <text>", "harness friction notes")
      .option("--notes <text>", "notes")
      .option("--no-score", "do not auto score-trace after recording")
      .action((opts) => {
        withErrors(() => executeTrace(opts));
      }),
  );

  addDirOptions(
    program
      .command("score-trace")
      .description("Score a trace against quality tiers")
      .option("--id <id>", "trace id (default: latest)")
      .action((opts) => {
        withErrors(() => executeScoreTrace(opts));
      }),
  );

  addDirOptions(
    program
      .command("audit")
      .description("Run drift audit and entropy score")
      .action((opts) => {
        withErrors(() => executeAudit(opts));
      }),
  );

  addDirOptions(
    program
      .command("propose")
      .description(
        "Generate improvement proposals from audit findings (optional --commit to backlog)",
      )
      .option(
        "--commit",
        "write new proposals into the backlog (skips existing open titles)",
      )
      .action((opts) => {
        withErrors(() => executePropose(opts));
      }),
  );

  addDirOptions(
    query
      .command("tools")
      .description("List built-in harness tools (compiled registry)")
      .option("--capability <name>", "filter by capability")
      .option("--status <status>", "filter by status (e.g. present)")
      .action((opts) => {
        withErrors(() => executeQuery("tools", opts));
      }),
  );

  program.parse(argv);
}

main();
