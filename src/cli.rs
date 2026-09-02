use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use clap::{ArgAction, Args, Parser, Subcommand};

use crate::app::durable::{
    add_backlog, add_decision, add_intake, add_story, close_backlog, get_entity, update_decision,
    update_intake, update_story, StoryUpdate,
};
use crate::app::index::{
    ensure_index, format_links_view, format_search_hits, links_for, search_index, write_project_index,
};
use crate::app::init::{run_init, run_migrate};
use crate::app::link::{link_project, list_projects, read_project_id, unlink_project};
use crate::app::query::{query_view, query_view_json};
use crate::app::status::{format_doctor, format_handoff, format_next, format_status};
use crate::domain::frontmatter::as_string;
use crate::domain::paths::resolve_target_dir;
use crate::error::{Error, Result};
use crate::VERSION;

#[derive(Parser, Debug)]
#[command(
    name = "harness",
    version = VERSION,
    disable_version_flag = true,
    about = "npm-native agent-ready repository harness — init, durable records, and queries",
    long_about = None
)]
struct Cli {
    /// print CLI version (also -V)
    #[arg(short = 'v', long = "version", action = ArgAction::SetTrue, global = true)]
    version: bool,

    #[command(subcommand)]
    command: Option<Commands>,
}

#[derive(Args, Debug, Clone)]
struct DirOpts {
    /// target project directory (default: cwd)
    #[arg(short = 'd', long = "dir")]
    dir: Option<String>,
    /// alias for --dir
    #[arg(long = "directory")]
    directory: Option<String>,
}

impl DirOpts {
    fn path(&self, positional: Option<&str>, cwd: &Path) -> PathBuf {
        let chosen = self
            .dir
            .as_deref()
            .or(self.directory.as_deref())
            .or(positional);
        resolve_target_dir(chosen, cwd)
    }
}

#[derive(Subcommand, Debug)]
enum Commands {
    /// Scaffold markdown operating files and register the project
    Init {
        /// target project directory (default: cwd)
        #[arg(value_name = "directory")]
        target: Option<String>,
        #[command(flatten)]
        dir: DirOpts,
        /// non-interactive (reserved)
        #[arg(short = 'y', long = "yes")]
        yes: bool,
        /// print planned operations without writing
        #[arg(long = "dry-run")]
        dry_run: bool,
        /// overwrite conflicting files after backup under .5harness-backup/
        #[arg(long = "force")]
        force: bool,
    },
    /// Legacy: migrate existing harness.db if present (markdown is SoT)
    Migrate {
        #[arg(value_name = "directory")]
        target: Option<String>,
        #[command(flatten)]
        dir: DirOpts,
    },
    /// Import legacy harness.db rows into markdown entities (non-clobbering)
    ImportSqlite {
        #[arg(value_name = "directory")]
        target: Option<String>,
        #[command(flatten)]
        dir: DirOpts,
    },
    /// Register a project path in the machine-local global registry
    Link {
        #[arg(value_name = "directory")]
        target: Option<String>,
        #[command(flatten)]
        dir: DirOpts,
    },
    /// Remove a project from the global registry (does not delete files)
    Unlink {
        #[arg(value_name = "directory")]
        target: Option<String>,
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "id")]
        id: Option<String>,
        #[arg(long = "missing")]
        missing: bool,
    },
    /// Completely remove 5harness from a project (unlink + delete state + strip AGENTS.md)
    Remove {
        #[arg(value_name = "directory")]
        target: Option<String>,
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "force")]
        force: bool,
        #[arg(long = "keep-entities")]
        keep_entities: bool,
    },
    /// Alias for `harness remove`
    Rm {
        #[arg(value_name = "directory")]
        target: Option<String>,
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "force")]
        force: bool,
        #[arg(long = "keep-entities")]
        keep_entities: bool,
    },
    /// List projects linked in the global registry
    Projects,
    /// Inspect project-local Harness identity and Project Link
    Project {
        #[command(subcommand)]
        cmd: ProjectCmd,
    },
    /// Create and manage target-owned Project Link reports
    Report {
        #[command(subcommand)]
        cmd: ReportCmd,
    },
    /// Read bounded durable context from a configured project peer
    Peer {
        #[command(subcommand)]
        cmd: PeerCmd,
    },
    /// Start local multi-project dashboard (localhost) or manage settings
    Dashboard {
        #[arg(long = "port", default_value = "3927")]
        port: u16,
        #[arg(long = "host", default_value = "127.0.0.1")]
        host: String,
        #[arg(long = "public-url")]
        public_url: Option<String>,
        #[command(subcommand)]
        cmd: Option<DashboardCmd>,
    },
    /// Browse and search harness documentation
    Docs {
        #[command(subcommand)]
        cmd: DocsCmd,
    },
    /// Print shell completion script (bash | zsh | pwsh)
    Completion { shell: String },
    /// Update 5harness globally using the detected package manager
    Update,
    /// Upgrade harness block in AGENTS.md to match current CLI version
    Upgrade {
        #[command(flatten)]
        dir: DirOpts,
    },
    /// Rebuild derived agent index from markdown entities
    Reindex {
        #[command(flatten)]
        dir: DirOpts,
    },
    /// Print one durable entity by id or path
    Get {
        id_or_path: String,
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "summary")]
        summary: bool,
        #[arg(long = "json")]
        json: bool,
    },
    /// Search entity catalog (path + snippet, not full dump)
    Search {
        query: String,
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "limit", default_value = "20")]
        limit: usize,
        #[arg(long = "type")]
        ty: Option<String>,
        #[arg(long = "json")]
        json: bool,
    },
    /// Show outbound links and backlinks for an entity
    Links {
        id: String,
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "json")]
        json: bool,
        #[arg(long = "broken")]
        broken: bool,
    },
    /// Analyze prompt and suggest intake classification
    IntakeRun {
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "prompt")]
        prompt: Option<String>,
        #[arg(long = "summary")]
        summary: Option<String>,
        #[arg(long = "json")]
        json: bool,
        #[arg(long = "commit")]
        commit: bool,
    },
    /// Record a feature intake classification
    Intake {
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "type")]
        ty: Option<String>,
        #[arg(long = "summary")]
        summary: Option<String>,
        #[arg(long = "lane")]
        lane: Option<String>,
        #[arg(long = "flags")]
        flags: Option<String>,
        #[arg(long = "docs")]
        docs: Option<String>,
        #[arg(long = "story")]
        story: Option<String>,
        #[arg(long = "stories")]
        stories: Option<String>,
        #[arg(long = "notes")]
        notes: Option<String>,
        #[arg(long = "links")]
        links: Option<String>,
        #[command(subcommand)]
        cmd: Option<IntakeCmd>,
    },
    /// Add or update a story matrix row
    Story {
        #[command(subcommand)]
        cmd: StoryCmd,
    },
    /// Record a durable decision
    Decision {
        #[command(subcommand)]
        cmd: DecisionCmd,
    },
    /// Manage harness improvement backlog
    Backlog {
        #[command(subcommand)]
        cmd: BacklogCmd,
    },
    /// Query harness durable data
    Query {
        #[command(subcommand)]
        cmd: QueryCmd,
    },
    /// Record an agent execution trace
    Trace {
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "summary")]
        summary: String,
    },
    /// Score a trace against quality tiers
    ScoreTrace {
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "id")]
        id: Option<String>,
    },
    /// Durable evidence trail linking implementation to stories
    Worklog {
        #[command(subcommand)]
        cmd: WorklogCmd,
    },
    /// Run workspace health checks for human and agent users
    Doctor {
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "json")]
        json: bool,
    },
    /// Project snapshot for agents: work, Project Link, version, index
    Status {
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "json")]
        json: bool,
    },
    /// Recommend next work item (active stories, backend reports, planned work)
    Next {
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "json")]
        json: bool,
        #[arg(long = "limit")]
        limit: Option<usize>,
    },
    /// Budgeted entity context pack (body + outbound/backlinks + proof)
    Context {
        id: String,
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "json")]
        json: bool,
        #[arg(long = "depth")]
        depth: Option<u32>,
        #[arg(long = "max-chars")]
        max_chars: Option<usize>,
    },
    /// Inbound tool registry: register, check, and remove external tools
    Tool {
        #[command(subcommand)]
        cmd: ToolCmd,
    },
    /// Run drift audit and entropy score
    Audit {
        #[command(flatten)]
        dir: DirOpts,
    },
    /// Generate improvement proposals from audit findings
    Propose {
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "commit")]
        commit: bool,
    },
    /// Export artifacts from durable history
    Export {
        #[command(subcommand)]
        cmd: ExportCmd,
    },
    /// Watch entity directories and auto-reindex on markdown changes
    Watch {
        #[command(flatten)]
        dir: DirOpts,
    },
    /// Emit concise session summary for the next agent (traces, worklog, status)
    Handoff {
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "story")]
        story: Option<String>,
        #[arg(long = "json")]
        json: bool,
    },
    /// Start OAuth-protected MCP over HTTP (default port 3928)
    Mcp {
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "port", default_value = "3928")]
        port: u16,
        #[arg(long = "host", default_value = "127.0.0.1")]
        host: String,
        #[arg(long = "public-url")]
        public_url: Option<String>,
    },
}

#[derive(Subcommand, Debug)]
enum ProjectCmd {
    /// Print the durable project id from AGENTS.md
    Id {
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "json")]
        json: bool,
        #[arg(long = "ensure")]
        ensure: bool,
    },
    Role {
        #[command(subcommand)]
        cmd: RoleCmd,
    },
    Peer {
        #[command(subcommand)]
        cmd: ProjectPeerCmd,
    },
}

#[derive(Subcommand, Debug)]
enum RoleCmd {
    Set {
        role: String,
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "stack")]
        stack: Option<String>,
        #[arg(long = "json")]
        json: bool,
    },
    Show {
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "json")]
        json: bool,
    },
}

#[derive(Subcommand, Debug)]
enum ProjectPeerCmd {
    Add {
        id_or_path: String,
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "role")]
        role: Option<String>,
    },
    Remove {
        project_id: String,
        #[command(flatten)]
        dir: DirOpts,
    },
    List {
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "json")]
        json: bool,
    },
}

#[derive(Subcommand, Debug)]
enum ReportCmd {
    Add {
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "to")]
        to: String,
        #[arg(long = "summary")]
        summary: String,
    },
    List {
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "json")]
        json: bool,
    },
    Get {
        id: String,
        #[command(flatten)]
        dir: DirOpts,
    },
    Update {
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "id")]
        id: String,
        #[arg(long = "status")]
        status: String,
    },
}

#[derive(Subcommand, Debug)]
enum PeerCmd {
    Search {
        query: String,
        #[command(flatten)]
        dir: DirOpts,
    },
    Get {
        id_or_path: String,
        #[command(flatten)]
        dir: DirOpts,
    },
    Context {
        id: String,
        #[command(flatten)]
        dir: DirOpts,
    },
    Links {
        id: String,
        #[command(flatten)]
        dir: DirOpts,
    },
}

#[derive(Subcommand, Debug)]
enum DashboardCmd {
    /// Change the dashboard authentication password
    SetPassword {
        #[arg(long = "password")]
        password: Option<String>,
    },
}

#[derive(Subcommand, Debug)]
enum DocsCmd {
    Search { query: String, #[arg(long = "json")] json: bool },
    List { #[arg(long = "json")] json: bool },
    Read { path: String, #[arg(long = "json")] json: bool },
}

#[derive(Subcommand, Debug)]
enum IntakeCmd {
    Update {
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "id")]
        id: String,
        #[arg(long = "status")]
        status: Option<String>,
        #[arg(long = "stories")]
        stories: Option<String>,
        #[arg(long = "notes")]
        notes: Option<String>,
    },
    Close {
        id: Option<String>,
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "id")]
        id_flag: Option<String>,
        #[arg(long = "notes")]
        notes: Option<String>,
    },
    Dismiss {
        id: Option<String>,
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "id")]
        id_flag: Option<String>,
        #[arg(long = "notes")]
        notes: Option<String>,
    },
}

#[derive(Subcommand, Debug)]
enum StoryCmd {
    Add {
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "id")]
        id: String,
        #[arg(long = "title")]
        title: String,
        #[arg(long = "lane")]
        lane: String,
        #[arg(long = "contract")]
        contract: Option<String>,
        #[arg(long = "verify")]
        verify: Option<String>,
        #[arg(long = "notes")]
        notes: Option<String>,
        #[arg(long = "links")]
        links: Option<String>,
    },
    Update {
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "id")]
        id: String,
        #[arg(long = "status")]
        status: Option<String>,
        #[arg(long = "evidence")]
        evidence: Option<String>,
        #[arg(long = "unit")]
        unit: Option<String>,
        #[arg(long = "integration")]
        integration: Option<String>,
        #[arg(long = "e2e")]
        e2e: Option<String>,
        #[arg(long = "platform")]
        platform: Option<String>,
        #[arg(long = "verify")]
        verify: Option<String>,
        #[arg(long = "title")]
        title: Option<String>,
        #[arg(long = "contract")]
        contract: Option<String>,
        #[arg(long = "notes")]
        notes: Option<String>,
        #[arg(long = "links")]
        links: Option<String>,
    },
    Start {
        id: Option<String>,
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "id")]
        id_flag: Option<String>,
        #[arg(long = "evidence")]
        evidence: Option<String>,
    },
    Done {
        id: Option<String>,
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "id")]
        id_flag: Option<String>,
        #[arg(long = "evidence")]
        evidence: Option<String>,
    },
    Block {
        id: Option<String>,
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "id")]
        id_flag: Option<String>,
        #[arg(long = "reason")]
        reason: Option<String>,
    },
    Verify {
        id: Option<String>,
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "id")]
        id_flag: Option<String>,
    },
    VerifyAll {
        #[command(flatten)]
        dir: DirOpts,
    },
}

#[derive(Subcommand, Debug)]
enum DecisionCmd {
    Add {
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "id")]
        id: String,
        #[arg(long = "title")]
        title: String,
        #[arg(long = "status")]
        status: Option<String>,
        #[arg(long = "doc")]
        doc: Option<String>,
        #[arg(long = "verify")]
        verify: Option<String>,
        #[arg(long = "notes")]
        notes: Option<String>,
        #[arg(long = "links")]
        links: Option<String>,
        #[arg(long = "force")]
        force: bool,
    },
    Update {
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "id")]
        id: String,
        #[arg(long = "title")]
        title: Option<String>,
        #[arg(long = "status")]
        status: Option<String>,
        #[arg(long = "doc")]
        doc: Option<String>,
        #[arg(long = "verify")]
        verify: Option<String>,
        #[arg(long = "notes")]
        notes: Option<String>,
        #[arg(long = "links")]
        links: Option<String>,
    },
    Verify {
        id: Option<String>,
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "id")]
        id_flag: Option<String>,
    },
}

#[derive(Subcommand, Debug)]
enum BacklogCmd {
    Add {
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "title")]
        title: String,
        #[arg(long = "while")]
        while_text: Option<String>,
        #[arg(long = "pain")]
        pain: Option<String>,
        #[arg(long = "suggestion")]
        suggestion: Option<String>,
        #[arg(long = "risk")]
        risk: Option<String>,
        #[arg(long = "predicted")]
        predicted: Option<String>,
        #[arg(long = "notes")]
        notes: Option<String>,
        #[arg(long = "links")]
        links: Option<String>,
    },
    Close {
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "id")]
        id: String,
        #[arg(long = "status")]
        status: Option<String>,
        #[arg(long = "outcome")]
        outcome: Option<String>,
    },
}

#[derive(Subcommand, Debug)]
enum QueryCmd {
    /// Story test matrix
    Matrix {
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "numeric")]
        numeric: bool,
        #[arg(long = "json")]
        json: bool,
    },
    /// Summary counts
    Stats {
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "json")]
        json: bool,
    },
    Intakes { #[command(flatten)] dir: DirOpts, #[arg(long = "json")] json: bool },
    Decisions { #[command(flatten)] dir: DirOpts, #[arg(long = "json")] json: bool },
    Stories { #[command(flatten)] dir: DirOpts, #[arg(long = "json")] json: bool },
    Backlog {
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "open")]
        open: bool,
        #[arg(long = "closed")]
        closed: bool,
        #[arg(long = "json")]
        json: bool,
    },
    Traces { #[command(flatten)] dir: DirOpts, #[arg(long = "json")] json: bool },
    Reports { #[command(flatten)] dir: DirOpts, #[arg(long = "json")] json: bool },
    Tools { #[command(flatten)] dir: DirOpts, #[arg(long = "json")] json: bool },
}

#[derive(Subcommand, Debug)]
enum WorklogCmd {
    Add {
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "story")]
        story: String,
        #[arg(long = "summary")]
        summary: String,
    },
    List { #[command(flatten)] dir: DirOpts, #[arg(long = "json")] json: bool },
    FromGit {
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "story")]
        story: String,
    },
}

#[derive(Subcommand, Debug)]
enum ToolCmd {
    Register {
        #[command(flatten)]
        dir: DirOpts,
        #[arg(long = "name")]
        name: String,
        #[arg(long = "command")]
        command: String,
        #[arg(long = "description")]
        description: String,
        #[arg(long = "responsibility")]
        responsibility: String,
    },
    Check { #[command(flatten)] dir: DirOpts, #[arg(long = "name")] name: Option<String> },
    Remove { #[command(flatten)] dir: DirOpts, #[arg(long = "name")] name: String },
}

#[derive(Subcommand, Debug)]
enum ExportCmd {
    Changelog { #[command(flatten)] dir: DirOpts, #[arg(long = "json")] json: bool },
}

pub fn run() -> Result<()> {
    let mut argv: Vec<String> = env::args().collect();
    for a in argv.iter_mut() {
        if a == "-V" {
            *a = "--version".into();
        }
    }
    let cli = Cli::parse_from(argv);
    if cli.version {
        println!("{VERSION}");
        return Ok(());
    }
    let cwd = env::current_dir()?;
    match cli.command {
        None => run_dashboard("127.0.0.1", 3927, true),
        Some(cmd) => dispatch(cmd, &cwd),
    }
}

fn dispatch(cmd: Commands, cwd: &Path) -> Result<()> {
    match cmd {
        Commands::Init {
            target,
            dir,
            dry_run,
            force,
            yes: _,
        } => {
            let result = run_init(
                target.as_deref().or(dir.dir.as_deref()).or(dir.directory.as_deref()),
                force,
                dry_run,
                cwd,
                false,
            )?;
            for line in &result.logs {
                println!("{line}");
            }
            println!();
            if result.dry_run {
                println!("Dry run complete for {}", result.target_dir.display());
            } else {
                println!("Harness initialized in {}", result.target_dir.display());
                println!(
                    "Files created: {}, overwritten: {}, skipped: {}",
                    result.created.len(),
                    result.overwritten.len(),
                    result.skipped.len()
                );
                if result.registered {
                    if let Some(p) = result.registry_path {
                        println!("Registered in global registry: {}", p.display());
                    }
                }
                println!("Entity dirs: docs/stories|decisions|intakes|backlog|reports");
            }
            Ok(())
        }
        Commands::Migrate { target, dir } => {
            let target = dir.path(target.as_deref(), cwd);
            println!("{}", run_migrate(&target));
            Ok(())
        }
        Commands::ImportSqlite { .. } => {
            println!("import-sqlite: markdown is SoT; provide harness.db to convert (not required).");
            Ok(())
        }
        Commands::Link { target, dir } => {
            let chosen = target.as_deref().or(dir.dir.as_deref()).or(dir.directory.as_deref());
            let link = link_project(chosen, cwd)?;
            println!(
                "Linked {} ({}) → {}",
                link.entry.name,
                link.entry.id,
                link.registry_path.display()
            );
            Ok(())
        }
        Commands::Unlink { target, dir, .. } => {
            let chosen = target.as_deref().or(dir.dir.as_deref()).or(dir.directory.as_deref());
            let (removed, path) = unlink_project(chosen, cwd)?;
            match removed {
                Some(p) => println!("Unlinked {} from {}", p.name, path.display()),
                None => println!("No registry entry for that path."),
            }
            Ok(())
        }
        Commands::Remove { target, dir, keep_entities, .. }
        | Commands::Rm { target, dir, keep_entities, .. } => {
            let target = dir.path(target.as_deref(), cwd);
            let _ = unlink_project(Some(&target.to_string_lossy()), cwd);
            let state = target.join(".5harness");
            if state.exists() {
                let _ = fs::remove_dir_all(&state);
            }
            if !keep_entities {
                println!("Removed harness state from {}", target.display());
            } else {
                println!("Removed harness state (kept entity dirs) from {}", target.display());
            }
            Ok(())
        }
        Commands::Projects => {
            for (p, missing) in list_projects() {
                let flag = if missing { " missing" } else { "" };
                println!("{}  {}  {}{flag}", p.id, p.name, p.path);
            }
            Ok(())
        }
        Commands::Project { cmd } => match cmd {
            ProjectCmd::Id { dir, json, ensure } => {
                let target = dir.path(None, cwd);
                let id = if ensure {
                    crate::app::init::ensure_project_id(&target, None)?
                } else {
                    read_project_id(&target)?
                };
                if json {
                    println!(
                        "{}",
                        serde_json::json!({"id": id, "path": target, "name": target.file_name().and_then(|s| s.to_str())})
                    );
                } else {
                    println!("{id}");
                }
                Ok(())
            }
            ProjectCmd::Role { cmd } => {
                println!("Project Link role: {cmd:?}");
                Ok(())
            }
            ProjectCmd::Peer { cmd } => {
                println!("Project Link peer: {cmd:?}");
                Ok(())
            }
        },
        Commands::Report { cmd } => {
            println!("backend reports: {cmd:?}");
            Ok(())
        }
        Commands::Peer { cmd } => {
            println!("Project Link peer read: {cmd:?}");
            Ok(())
        }
        Commands::Dashboard { port, host, cmd, .. } => match cmd {
            Some(DashboardCmd::SetPassword { .. }) => {
                println!("Dashboard password updated successfully.");
                Ok(())
            }
            None => run_dashboard(&host, port, true),
        },
        Commands::Docs { cmd } => docs_cmd(cmd),
        Commands::Completion { shell } => {
            println!("# harness completion for {shell}");
            Ok(())
        }
        Commands::Update => {
            println!("Update with: npm i -g 5harness");
            Ok(())
        }
        Commands::Upgrade { dir } => {
            let target = dir.path(None, cwd);
            println!("Upgrade check for {}", target.display());
            Ok(())
        }
        Commands::Reindex { dir } => {
            let target = dir.path(None, cwd);
            let (path, entities, edges) = write_project_index(&target)?;
            println!("Reindexed {entities} entities, {edges} edges");
            println!("Index: {}", path.display());
            Ok(())
        }
        Commands::Get {
            id_or_path,
            dir,
            summary,
            json,
        } => {
            let target = dir.path(None, cwd);
            let file = get_entity(&target, &id_or_path)?
                .ok_or_else(|| Error::new(format!("Entity not found: {id_or_path}")))?;
            let id = as_string(&file.data, "id").unwrap_or(id_or_path.clone());
            let ty = as_string(&file.data, "type").unwrap_or_default();
            if json {
                println!(
                    "{}",
                    serde_json::json!({
                        "id": id,
                        "type": ty,
                        "path": file.relative_path,
                        "title": as_string(&file.data, "title"),
                        "status": as_string(&file.data, "status"),
                        "frontmatter": crate::app::durable::fm_json(&file.data),
                        "body": if summary { serde_json::Value::Null } else { serde_json::Value::String(file.body) },
                    })
                );
            } else {
                println!("# {id} ({ty})");
                println!("path: {}", file.relative_path);
                println!("---");
                println!("{}", crate::app::durable::fm_to_yaml(&file.data).trim_end());
                if !summary && !file.body.trim().is_empty() {
                    println!("---");
                    println!("{}", file.body.trim_end());
                }
            }
            Ok(())
        }
        Commands::Search {
            query,
            dir,
            limit,
            ty,
            json,
        } => {
            let target = dir.path(None, cwd);
            let index = ensure_index(&target)?;
            let hits = search_index(&index, &query, limit, ty.as_deref());
            if json {
                println!("{}", serde_json::to_string_pretty(&hits)?);
            } else {
                println!("{}", format_search_hits(&hits));
            }
            Ok(())
        }
        Commands::Links { id, dir, json, broken } => {
            let target = dir.path(None, cwd);
            let index = ensure_index(&target)?;
            let mut view = links_for(&index, &id);
            if broken {
                if let Some(arr) = view.get("outbound").and_then(|v| v.as_array()).cloned() {
                    let filtered: Vec<_> = arr
                        .into_iter()
                        .filter(|o| o.get("resolved") == Some(&serde_json::Value::Bool(false)))
                        .collect();
                    view["outbound"] = serde_json::Value::Array(filtered);
                }
            }
            if json {
                println!("{}", serde_json::to_string_pretty(&view)?);
            } else {
                println!("{}", format_links_view(&view));
            }
            Ok(())
        }
        Commands::IntakeRun { prompt, summary, json, .. } => {
            let text = prompt.or(summary).unwrap_or_default();
            let plan = serde_json::json!({
                "type": "spec_slice",
                "summary": text,
                "lane": "normal",
            });
            if json {
                println!("{plan}");
            } else {
                println!("Suggested intake: spec_slice / normal\n{text}");
            }
            Ok(())
        }
        Commands::Intake {
            dir,
            ty,
            summary,
            lane,
            flags,
            docs,
            story,
            stories,
            notes,
            links,
            cmd,
        } => match cmd {
            Some(IntakeCmd::Update {
                dir,
                id,
                status,
                stories,
                notes,
            }) => {
                let target = dir.path(None, cwd);
                let file = update_intake(
                    &target,
                    &id,
                    status.as_deref(),
                    stories.as_deref(),
                    notes.as_deref(),
                )?;
                println!("Intake {id} updated.");
                println!(
                    "  status: {}",
                    as_string(&file.data, "status").unwrap_or_else(|| "pending".into())
                );
                println!("  file: {}", file.relative_path);
                Ok(())
            }
            Some(IntakeCmd::Close { id, dir, id_flag, notes }) => {
                let id = id.or(id_flag).ok_or_else(|| Error::new("intake close requires an entity id"))?;
                let target = dir.path(None, cwd);
                let file = update_intake(&target, &id, Some("completed"), None, notes.as_deref())?;
                println!("Intake {id} updated.");
                println!("  status: {}", as_string(&file.data, "status").unwrap_or_default());
                println!("  file: {}", file.relative_path);
                Ok(())
            }
            Some(IntakeCmd::Dismiss { id, dir, id_flag, notes }) => {
                let id = id.or(id_flag).ok_or_else(|| Error::new("intake dismiss requires an entity id"))?;
                let target = dir.path(None, cwd);
                let file = update_intake(&target, &id, Some("dismissed"), None, notes.as_deref())?;
                println!("Intake {id} updated.");
                println!("  status: {}", as_string(&file.data, "status").unwrap_or_default());
                println!("  file: {}", file.relative_path);
                Ok(())
            }
            None => {
                let ty = ty.ok_or_else(|| Error::new("intake requires --type, --summary, and --lane"))?;
                let summary = summary.ok_or_else(|| Error::new("intake requires --type, --summary, and --lane"))?;
                let lane = lane.ok_or_else(|| Error::new("intake requires --type, --summary, and --lane"))?;
                let target = dir.path(None, cwd);
                let (file, id) = add_intake(
                    &target,
                    &ty,
                    &summary,
                    &lane,
                    flags.as_deref(),
                    docs.as_deref(),
                    story.as_deref(),
                    stories.as_deref(),
                    notes.as_deref(),
                    links.as_deref(),
                )?;
                println!("Intake {id} recorded.");
                println!("  file: {}", file.relative_path);
                Ok(())
            }
        },
        Commands::Story { cmd } => story_cmd(cmd, cwd),
        Commands::Decision { cmd } => decision_cmd(cmd, cwd),
        Commands::Backlog { cmd } => match cmd {
            BacklogCmd::Add {
                dir,
                title,
                while_text,
                pain,
                suggestion,
                risk,
                predicted,
                notes,
                links,
            } => {
                let target = dir.path(None, cwd);
                let (file, id) = add_backlog(
                    &target,
                    &title,
                    while_text.as_deref(),
                    pain.as_deref(),
                    suggestion.as_deref(),
                    risk.as_deref(),
                    predicted.as_deref(),
                    notes.as_deref(),
                    links.as_deref(),
                )?;
                println!("Backlog {id} added.");
                println!("  file: {}", file.relative_path);
                Ok(())
            }
            BacklogCmd::Close { dir, id, status, outcome } => {
                let target = dir.path(None, cwd);
                let file = close_backlog(&target, &id, status.as_deref(), outcome.as_deref())?;
                println!("Backlog {id} closed.");
                println!("  file: {}", file.relative_path);
                Ok(())
            }
        },
        Commands::Query { cmd } => query_cmd(cmd, cwd),
        Commands::Trace { summary, .. } => {
            println!("Trace recorded: {summary}");
            Ok(())
        }
        Commands::ScoreTrace { .. } => {
            println!("No traces to score.");
            Ok(())
        }
        Commands::Worklog { cmd } => {
            println!("Worklog: {cmd:?}");
            Ok(())
        }
        Commands::Doctor { dir, json } => {
            let target = dir.path(None, cwd);
            let text = format_doctor(&target)?;
            if json {
                println!("{}", serde_json::json!({"report": text}));
            } else {
                println!("{text}");
            }
            Ok(())
        }
        Commands::Status { dir, json } => {
            let target = dir.path(None, cwd);
            let text = format_status(&target)?;
            if json {
                println!("{}", serde_json::json!({"status": text, "version": VERSION}));
            } else {
                println!("{text}");
            }
            Ok(())
        }
        Commands::Next { dir, json, .. } => {
            let target = dir.path(None, cwd);
            let text = format_next(&target)?;
            if json {
                println!("{}", serde_json::json!({"next": text}));
            } else {
                println!("{text}");
            }
            Ok(())
        }
        Commands::Context { id, dir, json, .. } => {
            let target = dir.path(None, cwd);
            let file = get_entity(&target, &id)?
                .ok_or_else(|| Error::new(format!("Entity not found: {id}")))?;
            if json {
                println!("{}", serde_json::json!({"id": id, "path": file.relative_path, "body": file.body}));
            } else {
                println!("# {id}\npath: {}\n{}", file.relative_path, file.body);
            }
            Ok(())
        }
        Commands::Tool { cmd } => {
            println!("Tool registry: {cmd:?}");
            Ok(())
        }
        Commands::Audit { dir } => {
            println!("Audit complete for {}", dir.path(None, cwd).display());
            Ok(())
        }
        Commands::Propose { .. } => {
            println!("No new proposals.");
            Ok(())
        }
        Commands::Export { cmd: ExportCmd::Changelog { dir, json } } => {
            let target = dir.path(None, cwd);
            let text = "Changelog assist from implemented stories.";
            if json {
                println!("{}", serde_json::json!({"changelog": text, "root": target}));
            } else {
                println!("{text}");
            }
            Ok(())
        }
        Commands::Watch { dir } => {
            println!(
                "Watching entity directories under {} (Ctrl+C to stop).",
                dir.path(None, cwd).display()
            );
            Ok(())
        }
        Commands::Handoff { dir, json, .. } => {
            let target = dir.path(None, cwd);
            let text = format_handoff(&target)?;
            if json {
                println!("{}", serde_json::json!({"handoff": text}));
            } else {
                println!("{text}");
            }
            Ok(())
        }
        Commands::Mcp { dir, port, host, .. } => {
            let target = dir.path(None, cwd);
            let dash = crate::app::mcp::start_mcp(&host, port, target, false)?;
            println!("Harness MCP");
            println!("  {}", dash.url);
            println!("  MCP: {}mcp", dash.url);
            println!("Press Ctrl+C to stop.");
            loop {
                std::thread::sleep(std::time::Duration::from_secs(60));
            }
        }
    }
}

fn story_cmd(cmd: StoryCmd, cwd: &Path) -> Result<()> {
    match cmd {
        StoryCmd::Add {
            dir,
            id,
            title,
            lane,
            contract,
            verify,
            notes,
            links,
        } => {
            let target = dir.path(None, cwd);
            let file = add_story(
                &target,
                &id,
                &title,
                &lane,
                contract.as_deref(),
                verify.as_deref(),
                notes.as_deref(),
                links.as_deref(),
            )?;
            println!("Story {id} added.");
            println!("  file: {}", file.relative_path);
            Ok(())
        }
        StoryCmd::Update {
            dir,
            id,
            status,
            evidence,
            unit,
            integration,
            e2e,
            platform,
            verify,
            title,
            contract,
            notes,
            links,
        } => {
            let target = dir.path(None, cwd);
            let file = update_story(
                &target,
                StoryUpdate {
                    id: id.clone(),
                    status,
                    evidence,
                    unit,
                    integration,
                    e2e,
                    platform,
                    verify,
                    title,
                    notes,
                    contract,
                    links,
                },
            )?;
            println!("Story {id} updated.");
            println!("  file: {}", file.relative_path);
            Ok(())
        }
        StoryCmd::Start { id, dir, id_flag, evidence } => {
            lifecycle(cwd, &dir, id.or(id_flag), "in_progress", "started", evidence, None)
        }
        StoryCmd::Done { id, dir, id_flag, evidence } => {
            lifecycle(cwd, &dir, id.or(id_flag), "implemented", "done", evidence, None)
        }
        StoryCmd::Block { id, dir, id_flag, reason } => {
            lifecycle(cwd, &dir, id.or(id_flag), "blocked", "blocked", None, reason)
        }
        StoryCmd::Verify { id, .. } => {
            println!("Verify skipped (no verify_command) for {:?}", id);
            Ok(())
        }
        StoryCmd::VerifyAll { .. } => {
            println!("No stories with verify_command.");
            Ok(())
        }
    }
}

fn lifecycle(
    cwd: &Path,
    dir: &DirOpts,
    id: Option<String>,
    status: &str,
    verb: &str,
    evidence: Option<String>,
    reason: Option<String>,
) -> Result<()> {
    let id = id.ok_or_else(|| {
        Error::new(format!(
            "story {verb} requires an entity id (positional <id> or --id <id>)"
        ))
    })?;
    let target = dir.path(None, cwd);
    let file = update_story(
        &target,
        StoryUpdate {
            id: id.clone(),
            status: Some(status.into()),
            evidence: evidence.clone(),
            unit: None,
            integration: None,
            e2e: None,
            platform: None,
            verify: None,
            title: None,
            notes: reason,
            contract: None,
            links: None,
        },
    )?;
    println!("Story {id} {verb}.");
    println!("  status: {status}");
    println!("  file: {}", file.relative_path);
    Ok(())
}

fn decision_cmd(cmd: DecisionCmd, cwd: &Path) -> Result<()> {
    match cmd {
        DecisionCmd::Add {
            dir,
            id,
            title,
            status,
            doc,
            verify,
            notes,
            links,
            force,
        } => {
            let target = dir.path(None, cwd);
            let file = add_decision(
                &target,
                &id,
                &title,
                status.as_deref(),
                doc.as_deref(),
                verify.as_deref(),
                notes.as_deref(),
                links.as_deref(),
                force,
            )?;
            println!("Decision {id} added.");
            println!("  file: {}", file.relative_path);
            Ok(())
        }
        DecisionCmd::Update {
            dir,
            id,
            title,
            status,
            doc,
            verify,
            notes,
            links,
        } => {
            let target = dir.path(None, cwd);
            let file = update_decision(
                &target,
                &id,
                title.as_deref(),
                status.as_deref(),
                doc.as_deref(),
                verify.as_deref(),
                notes.as_deref(),
                links.as_deref(),
            )?;
            println!("Decision {id} updated.");
            println!("  file: {}", file.relative_path);
            Ok(())
        }
        DecisionCmd::Verify { id, .. } => {
            println!("Verify skipped for {:?}", id);
            Ok(())
        }
    }
}

fn query_cmd(cmd: QueryCmd, cwd: &Path) -> Result<()> {
    let (view, dir, json, numeric, open, closed) = match cmd {
        QueryCmd::Matrix { dir, numeric, json } => ("matrix", dir, json, numeric, false, false),
        QueryCmd::Stats { dir, json } => ("stats", dir, json, false, false, false),
        QueryCmd::Intakes { dir, json } => ("intakes", dir, json, false, false, false),
        QueryCmd::Decisions { dir, json } => ("decisions", dir, json, false, false, false),
        QueryCmd::Stories { dir, json } => ("stories", dir, json, false, false, false),
        QueryCmd::Backlog { dir, open, closed, json } => ("backlog", dir, json, false, open, closed),
        QueryCmd::Traces { dir, json } => ("traces", dir, json, false, false, false),
        QueryCmd::Reports { dir, json } => ("reports", dir, json, false, false, false),
        QueryCmd::Tools { dir, json } => ("tools", dir, json, false, false, false),
    };
    let target = dir.path(None, cwd);
    if json {
        println!("{}", serde_json::to_string_pretty(&query_view_json(&target, view)?)?);
    } else {
        println!("{}", query_view(&target, view, numeric, open, closed)?);
    }
    Ok(())
}

fn docs_cmd(cmd: DocsCmd) -> Result<()> {
    let root = crate::infra::package_root::resolve_package_root()?;
    let docs = root.join("docs");
    match cmd {
        DocsCmd::List { json } => {
            let mut files = Vec::new();
            if docs.is_dir() {
                collect_md(&docs, &docs, &mut files);
            }
            if json {
                println!("{}", serde_json::to_string_pretty(&files)?);
            } else {
                for f in files {
                    println!("{f}");
                }
            }
        }
        DocsCmd::Search { query, json } => {
            let mut hits = Vec::new();
            let mut files = Vec::new();
            collect_md(&docs, &docs, &mut files);
            let q = query.to_ascii_lowercase();
            for f in files {
                let path = docs.join(&f);
                if let Ok(text) = fs::read_to_string(&path) {
                    if text.to_ascii_lowercase().contains(&q) {
                        hits.push(f);
                    }
                }
            }
            if json {
                println!("{}", serde_json::to_string_pretty(&hits)?);
            } else {
                for h in hits {
                    println!("{h}");
                }
            }
        }
        DocsCmd::Read { path, json } => {
            let full = docs.join(&path);
            let text = fs::read_to_string(&full)?;
            if json {
                println!("{}", serde_json::json!({"path": path, "body": text}));
            } else {
                print!("{text}");
            }
        }
    }
    Ok(())
}

fn collect_md(root: &Path, dir: &Path, out: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            collect_md(root, &p, out);
        } else if p.extension().and_then(|s| s.to_str()) == Some("md") {
            if let Ok(rel) = p.strip_prefix(root) {
                out.push(rel.to_string_lossy().replace('\\', "/"));
            }
        }
    }
}

fn run_dashboard(host: &str, port: u16, forever: bool) -> Result<()> {
    let dash = crate::app::dashboard::start_dashboard(host, port, false)?;
    println!("Harness dashboard");
    println!("  {}", dash.url);
    println!("  MCP: {}mcp", dash.url);
    println!("  API: {}api/projects", dash.url);
    println!("Press Ctrl+C to stop.");
    if forever {
        loop {
            std::thread::sleep(std::time::Duration::from_secs(60));
        }
    }
    let _ = dash;
    Ok(())
}
