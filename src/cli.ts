#!/usr/bin/env node
import { Command } from "commander";
import { executeDashboard } from "./commands/dashboard.js";
import { executeAudit } from "./commands/audit.js";
import {
  executeDocsSearch,
  executeDocsList,
  executeDocsRead,
} from "./commands/docs.js";

import { executeDoctor } from "./commands/doctor.js";

import { executeStatus } from "./commands/status.js";

import { executeNext } from "./commands/next.js";

import { executeContext } from "./commands/context.js";

import {
  executeToolRegister,
  executeToolCheck,
  executeToolRemove,
} from "./commands/tool.js";

import { executeBacklogAdd, executeBacklogClose } from "./commands/backlog.js";
import { executeDecisionAdd } from "./commands/decision.js";
import {
  executeGet,
  executeLinks,
  executeReindex,
  executeSearch,
} from "./commands/index-tools.js";
import { executeInit } from "./commands/init.js";
import { executeIntake } from "./commands/intake.js";
import {
  executeLink,
  executeProjects,
  executeUnlink,
} from "./commands/link.js";
import { executeImportSqlite } from "./commands/import-sqlite.js";
import { executeMigrate } from "./commands/migrate.js";
import { executePropose } from "./commands/propose.js";
import { executeQuery } from "./commands/query.js";
import {
  executeStoryAdd,
  executeStoryUpdate,
  executeStoryStart,
  executeStoryDone,
  executeStoryBlock,
} from "./commands/story.js";
import {
  executeWorklogAdd,
  executeWorklogList,
  executeWorklogFromGit,
} from "./commands/worklog.js";


import { executeScoreTrace, executeTrace } from "./commands/trace.js";
import { executeUpdate, executeRepoUpgrade } from "./commands/update.js";
import {
  executeDecisionVerify,
  executeStoryVerify,
  executeStoryVerifyAll,
} from "./commands/verify.js";
import { maybeNotifyUpdateAvailable } from "./application/update-check.js";
import { maybeNotifyRepoUpgrade } from "./application/upgrade-notify.js";

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

/**
 * Commander allows only one short flag on `.version()`. Prefer `-v, --version`
 * (common CLI convention) and treat `-V` as an equivalent alias.
 */
function normalizeArgv(argv: string[]): string[] {
  return argv.map((arg) => (arg === "-V" ? "--version" : arg));
}

async function main(argv: string[] = process.argv): Promise<void> {
  const program = new Command();
  const args = normalizeArgv(argv);

  program
    .name("harness")
    .description(
      "npm-native agent-ready repository harness — init, durable records, and queries",
    )
    .version(VERSION, "-v, --version", "print CLI version (also -V)");

  // Cached, fail-open update notice (skipped in CI / when disabled). See docs/SECURITY.md style trust: advisory only.
  program.hook("preAction", async () => {
    await maybeNotifyUpdateAvailable({
      currentVersion: VERSION,
      argv: args,
    });
    maybeNotifyRepoUpgrade(process.cwd(), VERSION);

  });

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
      .description(
        "Legacy: migrate existing harness.db if present (markdown is SoT)",
      )
      .argument("[directory]", "target project directory (default: cwd)")
      .action((directory: string | undefined, opts) => {
        withErrors(() => executeMigrate(directory, opts));
      }),
  );

  addDirOptions(
    program
      .command("import-sqlite")
      .description(
        "Import legacy harness.db rows into markdown entities (non-clobbering)",
      )
      .argument("[directory]", "target project directory (default: cwd)")
      .option("--db <path>", "path to harness.db (default: <project>/harness.db)")
      .option("--force", "overwrite existing entity files")
      .action((directory: string | undefined, opts) => {
        withErrors(() => executeImportSqlite(directory, opts));
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

  program
    .command("dashboard")
    .description(
      "Start local read-only multi-project dashboard (localhost)",
    )
    .option("--port <n>", "port (default 3927)", "3927")
    .option("--host <addr>", "bind address (default 127.0.0.1)", "127.0.0.1")
    .action((opts) => {
      withErrors(() => {
        void executeDashboard(opts).catch((error: unknown) => {
          const message =
            error instanceof Error ? error.message : String(error);
          console.error(`error: ${message}`);
          process.exit(1);
        });
      });
    });

  // Docs command group
  const docsCmd = program
    .command("docs")
    .description("Browse and search harness documentation");
  docsCmd
    .command("search")
    .description("Search harness docs for text (snippet results)")
    .argument("<query>", "search query text")
    .action((query: string) => {
      withErrors(() => executeDocsSearch(query));
    });
  docsCmd
    .command("list")
    .description("List all available harness documentation files")
    .action(() => {
      withErrors(() => executeDocsList());
    });
  docsCmd
    .command("read")
    .description("Read a harness documentation file in full")
    .argument("<path>", "relative path within docs/ (e.g. HARNESS.md)")
    .action((docPath: string) => {
      withErrors(() => executeDocsRead(docPath));
    });


  program
    .command("update")
    .description(
      "Update @vantanminh/harness globally using the detected package manager",
    )
    .action(() => {
      withErrors(() => executeUpdate());
    });


  addDirOptions(
    program
      .command("upgrade")
      .description(
        "Upgrade harness block in AGENTS.md to match current CLI version (only updates HARNESS:BEGIN/END section)",
      )
      .action((opts) => {
        withErrors(() => executeRepoUpgrade(opts));
      }),
  );


  addDirOptions(
    program
      .command("reindex")
      .description("Rebuild derived agent index from markdown entities")
      .action((opts) => {
        withErrors(() => executeReindex(opts));
      }),
  );

  addDirOptions(
    program
      .command("get")
      .description("Print one durable entity by id or path")
      .argument("<idOrPath>", "entity id (e.g. US-001) or relative path")
      .option("--summary", "frontmatter only (no body)")
      .action((idOrPath: string, opts) => {
        withErrors(() => executeGet(idOrPath, opts));
      }),
  );

  addDirOptions(
    program
      .command("search")
      .description("Search entity catalog (path + snippet, not full dump)")
      .argument("<query>", "search query")
      .option("--limit <n>", "max hits", "20")
      .action((query: string, opts) => {
        withErrors(() => executeSearch(query, opts));
      }),
  );

  addDirOptions(
    program
      .command("links")
      .description("Show outbound links and backlinks for an entity")
      .argument("<id>", "entity id")
      .action((id: string, opts) => {
        withErrors(() => executeLinks(id, opts));
      }),
  );

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
      .command("start")
      .description("Mark a story as in_progress (lifecycle verb)")
      .argument("<id>", "story id")
      .option("--evidence <text>", "evidence label")
      .action((id, opts) => {
        withErrors(() => executeStoryStart(id, opts));
      }),
  );

  addDirOptions(
    story
      .command("done")
      .description("Mark a story as implemented (lifecycle verb)")
      .argument("<id>", "story id")
      .option("--evidence <text>", "evidence label")
      .action((id, opts) => {
        withErrors(() => executeStoryDone(id, opts));
      }),
  );

  addDirOptions(
    story
      .command("block")
      .description("Mark a story as blocked (lifecycle verb)")
      .argument("<id>", "story id")
      .option("--reason <text>", "block reason")
      .action((id, opts) => {
        withErrors(() => executeStoryBlock(id, opts));
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
  // -- Worklog ---------------------------------------------------------------
  const worklog = program
    .command("worklog")
    .description("Durable evidence trail linking implementation to stories");

  addDirOptions(
    worklog
      .command("add")
      .description("Add a worklog entry for a story")
      .requiredOption("--story <id>", "story id")
      .requiredOption("--summary <text>", "what was done")
      .option("--pr <url>", "pull request URL")
      .option("--commit <hash>", "commit hash")
      .option("--evidence <text>", "evidence label")
      .option("--json", "machine-readable JSON output")
      .action((opts) => {
        withErrors(() => executeWorklogAdd(opts));
      }),
  );

  addDirOptions(
    worklog
      .command("list")
      .description("List worklog entries")
      .option("--json", "machine-readable JSON output")
      .action((opts) => {
        withErrors(() => executeWorklogList(opts));
      }),
  );

  addDirOptions(
    worklog
      .command("from-git")
      .description("Link recent git commits to a story as worklog entries")
      .requiredOption("--story <id>", "story id")
      .option("--since <date>", "git log --since filter (e.g. 2026-07-01)")
      .option("--json", "machine-readable JSON output")
      .action((opts) => {
        withErrors(() => executeWorklogFromGit(opts));
      }),
  );



  // -- Doctor ---------------------------------------------------------------
  addDirOptions(
    program
      .command("doctor")
      .description("Run workspace health checks for human and agent users")
      .option("--json", "machine-readable JSON output")
      .action((opts) => {
        withErrors(() => executeDoctor(opts));
      }),
  );

  addDirOptions(
    program
      .command("status")
      .description("Project snapshot for agents: stories, intakes, backlog, version, index")
      .option("--json", "machine-readable JSON output")
      .action((opts) => {
        withErrors(() => executeStatus(opts));
      }),
  );

  addDirOptions(
    program
      .command("next")
      .description("Recommend next work item (in_progress stories first, then planned, intakes, backlog)")
      .option("--json", "machine-readable JSON output")
      .option("--limit <N>", "max items to show (default: 10)")
      .action((opts) => {
        withErrors(() => executeNext(opts));
      }),
  );

  addDirOptions(
    program
      .command("context")
      .description("Budgeted entity context pack (body + outbound/backlinks + proof)")
      .argument("<id>", "entity id (e.g. US-018)")
      .option("--json", "machine-readable JSON output")
      .option("--depth <0|1>", "link depth: 0 = summaries only, 1 = include excerpts (default: 0)")
      .option("--max-chars <N>", "max character budget (default: 8000)")
      .action((id, opts) => {
        withErrors(() => executeContext(id, opts));
      }),
  );

  // -- Tool Registry ---------------------------------------------------------
  const toolCmd = program
    .command("tool")
    .description("Inbound tool registry: register, check, and remove external tools");

  addDirOptions(
    toolCmd
      .command("register")
      .description("Register an external project tool")
      .requiredOption("--name <name>", "unique tool name")
      .requiredOption("--command <command>", "command path or run string")
      .requiredOption("--description <desc>", "10-200 char description")
      .requiredOption("--responsibility <resp>", "responsibility label")
      .option("--kind <kind>", "cli | binary | mcp | skill | http (default: cli)")
      .option("--capability <name>", "workflow capability (kebab-case)")
      .option("--scan <path>", "declarative path/URL for mcp/skill/http")
      .option("--args <args>", "parameter spec (name:type:required:help)")
      .option("--force", "skip PATH check for cli/binary")
      .option("--json", "machine-readable JSON output")
      .action((opts) => {
        withErrors(() => executeToolRegister(opts));
      }),
  );

  addDirOptions(
    toolCmd
      .command("check")
      .description("Scan registered tools and persist present/missing status")
      .option("--name <name>", "check a single tool")
      .option("--json", "machine-readable JSON output")
      .action((opts) => {
        withErrors(() => executeToolCheck(opts));
      }),
  );

  addDirOptions(
    toolCmd
      .command("remove")
      .description("Remove a registered external tool")
      .requiredOption("--name <name>", "tool name to remove")
      .option("--json", "machine-readable JSON output")
      .action((opts) => {
        withErrors(() => executeToolRemove(opts));
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

  // Default action: no subcommand → start dashboard
  program.action(() => {
    withErrors(() => {
      void executeDashboard().catch(fail);
    });
  });

  await program.parseAsync(args);
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`error: ${message}`);
  process.exit(1);
});
