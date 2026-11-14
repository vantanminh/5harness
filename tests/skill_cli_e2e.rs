use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

fn bin() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_harness"))
}

fn temp_dir(label: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!(
        "harness-skill-e2e-{label}-{}-{nonce}",
        std::process::id()
    ));
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn run(args: &[&str], cwd: &Path, harness_home: &Path, agent_home: &Path) -> std::process::Output {
    Command::new(bin())
        .args(args)
        .current_dir(cwd)
        .env("HARNESS_NO_UPDATE_CHECK", "1")
        .env("HARNESS_HOME", harness_home)
        .env("HARNESS_AGENT_HOME", agent_home)
        .output()
        .expect("spawn harness")
}

fn stdout(out: &std::process::Output) -> String {
    String::from_utf8_lossy(&out.stdout).into_owned()
}

fn stderr(out: &std::process::Output) -> String {
    String::from_utf8_lossy(&out.stderr).into_owned()
}

#[test]
fn skill_agents_and_show_expose_supported_targets_and_bundled_skill() {
    let root = temp_dir("agents");
    let harness_home = root.join("harness-home");
    let agent_home = root.join("agent-home");
    fs::create_dir_all(&harness_home).unwrap();
    fs::create_dir_all(agent_home.join(".gemini").join("config")).unwrap();

    let help = run(&["skill", "--help"], &root, &harness_home, &agent_home);
    assert!(help.status.success(), "{}", stderr(&help));
    let help_text = stdout(&help);
    assert!(help_text.contains("add"), "{help_text}");
    assert!(help_text.contains("list"), "{help_text}");
    assert!(help_text.contains("remove"), "{help_text}");
    assert!(help_text.contains("agents"), "{help_text}");
    assert!(help_text.contains("show"), "{help_text}");

    let alias = run(
        &["skills", "agents", "--json"],
        &root,
        &harness_home,
        &agent_home,
    );
    assert!(alias.status.success(), "{}", stderr(&alias));
    let agents: serde_json::Value = serde_json::from_str(&stdout(&alias)).unwrap();
    let list = agents.as_array().unwrap();
    let antigravity = list.iter().find(|a| a["id"] == "antigravity").unwrap();
    assert_eq!(antigravity["detected_global"], true);
    assert_eq!(antigravity["global_skills_dir"], ".gemini/config/skills");
    assert!(list.iter().any(|a| a["id"] == "claude-code"));
    assert!(list.iter().any(|a| a["id"] == "cursor"));
    assert!(list.iter().any(|a| a["id"] == "codex"));

    let show = run(
        &["skill", "show", "--json"],
        &root,
        &harness_home,
        &agent_home,
    );
    assert!(show.status.success(), "{}", stderr(&show));
    let shown: serde_json::Value = serde_json::from_str(&stdout(&show)).unwrap();
    assert_eq!(shown["name"], "harness");
    let content = shown["content"].as_str().unwrap();
    assert!(content.contains("Parent workspace mode"), "{content}");
    assert!(content.contains("harness workspace context"), "{content}");
    assert!(content.contains("harness skill add --global"), "{content}");

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn skill_add_global_detects_agents_installs_lists_and_removes_cleanly() {
    let root = temp_dir("global");
    let parent_ws = root.join("big-workspace");
    let harness_home = root.join("harness-home");
    let agent_home = root.join("agent-home");
    fs::create_dir_all(&parent_ws).unwrap();
    fs::create_dir_all(&harness_home).unwrap();
    fs::create_dir_all(agent_home.join(".gemini").join("config")).unwrap();
    fs::create_dir_all(agent_home.join(".claude")).unwrap();

    // Dry run must preview targets without creating files.
    let dry = run(
        &["skill", "add", "--global", "--dry-run", "--json"],
        &parent_ws,
        &harness_home,
        &agent_home,
    );
    assert!(dry.status.success(), "{}", stderr(&dry));
    let dry_json: serde_json::Value = serde_json::from_str(&stdout(&dry)).unwrap();
    assert_eq!(dry_json["dry_run"], true);
    assert_eq!(dry_json["scope"], "global");
    assert!(!agent_home.join(".claude/skills/harness/SKILL.md").exists());
    assert!(!agent_home
        .join(".gemini/config/skills/harness/SKILL.md")
        .exists());

    // Actual install writes detected agents + universal without touching parent_ws.
    let add = run(
        &["skill", "add", "--global", "--json"],
        &parent_ws,
        &harness_home,
        &agent_home,
    );
    assert!(add.status.success(), "{}", stderr(&add));
    let add_json: serde_json::Value = serde_json::from_str(&stdout(&add)).unwrap();
    let targets = add_json["installed"][0]["targets"].as_array().unwrap();
    assert_eq!(targets.len(), 3, "{targets:?}");
    assert!(targets.iter().all(|t| t["action"] == "created"));
    assert!(agent_home.join(".agents/skills/harness/SKILL.md").is_file());
    assert!(agent_home.join(".claude/skills/harness/SKILL.md").is_file());
    assert!(agent_home
        .join(".gemini/config/skills/harness/SKILL.md")
        .is_file());
    assert!(
        !parent_ws.join(".agents").exists(),
        "global install must not touch cwd"
    );
    assert!(harness_home.join("skills-lock.json").is_file());

    // Idempotent second run reports unchanged.
    let again = run(
        &["skill", "add", "--global", "--json"],
        &parent_ws,
        &harness_home,
        &agent_home,
    );
    assert!(again.status.success(), "{}", stderr(&again));
    let again_json: serde_json::Value = serde_json::from_str(&stdout(&again)).unwrap();
    assert!(again_json["installed"][0]["targets"]
        .as_array()
        .unwrap()
        .iter()
        .all(|t| t["action"] == "unchanged"));

    // List global skills and remove only claude-code target.
    let list = run(
        &["skill", "list", "--global", "--json"],
        &parent_ws,
        &harness_home,
        &agent_home,
    );
    assert!(list.status.success(), "{}", stderr(&list));
    let items: serde_json::Value = serde_json::from_str(&stdout(&list)).unwrap();
    assert_eq!(items.as_array().unwrap().len(), 3);

    let remove = run(
        &[
            "skill",
            "remove",
            "harness",
            "--global",
            "-a",
            "claude-code",
            "--json",
        ],
        &parent_ws,
        &harness_home,
        &agent_home,
    );
    assert!(remove.status.success(), "{}", stderr(&remove));
    assert!(!agent_home.join(".claude/skills/harness").exists());
    assert!(agent_home
        .join(".gemini/config/skills/harness/SKILL.md")
        .is_file());

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn skill_add_local_multi_skill_requires_selection_and_copies_supporting_files() {
    let root = temp_dir("local-multi");
    let harness_home = root.join("harness-home");
    let agent_home = root.join("agent-home");
    let src_repo = root.join("external-skills");
    let project = root.join("app");
    fs::create_dir_all(&harness_home).unwrap();
    fs::create_dir_all(&agent_home).unwrap();
    fs::create_dir_all(&project).unwrap();

    fs::create_dir_all(src_repo.join("skills/api-contract/references")).unwrap();
    fs::write(
        src_repo.join("skills/api-contract/SKILL.md"),
        "---\nname: api-contract\ndescription: Validate OpenAPI contracts before releases.\n---\n# API Contract\n",
    )
    .unwrap();
    fs::write(
        src_repo.join("skills/api-contract/references/schema.md"),
        "# Schema Rules\n",
    )
    .unwrap();
    fs::create_dir_all(src_repo.join("skills/ui-audit")).unwrap();
    fs::write(
        src_repo.join("skills/ui-audit/SKILL.md"),
        "---\nname: ui-audit\ndescription: Audit UI layouts.\n---\n# UI Audit\n",
    )
    .unwrap();

    let src_arg = src_repo.to_string_lossy().into_owned();

    // Multi-skill without --skill or --all fails closed cleanly.
    let ambig = run(
        &["skill", "add", &src_arg],
        &project,
        &harness_home,
        &agent_home,
    );
    assert!(!ambig.status.success());
    let err = stderr(&ambig);
    assert!(
        err.contains("api-contract") && err.contains("ui-audit"),
        "{err}"
    );

    // Selecting one skill + target agent installs SKILL.md and supporting files.
    let add = run(
        &[
            "skill",
            "add",
            &src_arg,
            "--skill",
            "api-contract",
            "-a",
            "claude-code",
            "--json",
        ],
        &project,
        &harness_home,
        &agent_home,
    );
    assert!(add.status.success(), "{}", stderr(&add));
    assert!(project
        .join(".claude/skills/api-contract/SKILL.md")
        .is_file());
    assert!(project
        .join(".claude/skills/api-contract/references/schema.md")
        .is_file());
    assert!(!project.join(".claude/skills/ui-audit").exists());

    // Unsafe URLs, option injection, and traversal names must fail closed.
    let bad_url = run(
        &["skill", "add", "http://example.com/repo"],
        &project,
        &harness_home,
        &agent_home,
    );
    assert!(!bad_url.status.success());

    let bad_name = run(
        &["skill", "remove", "../outside"],
        &project,
        &harness_home,
        &agent_home,
    );
    assert!(!bad_name.status.success());

    let _ = fs::remove_dir_all(&root);
}

#[test]
fn upgrade_syncs_managed_block_preserves_custom_prose_and_updates_skill() {
    let root = temp_dir("upgrade");
    let harness_home = root.join("harness-home");
    let agent_home = root.join("agent-home");
    let project = root.join("repo");
    fs::create_dir_all(&harness_home).unwrap();
    fs::create_dir_all(&agent_home).unwrap();
    fs::create_dir_all(project.join(".agents/skills/harness")).unwrap();

    let initial_agents = "\
# My Custom Repo Rules

Keep all API responses camelCase.

<!-- HARNESS:BEGIN -->
<!-- harness-version: 0.19.0 -->
<!-- harness-project-id: 0123456789abcdef0123456789abcdef -->
## Harness

Outdated old block text.
<!-- HARNESS:END -->

## Extra Footer Notes

Do not drop this custom section.
";
    fs::write(project.join("AGENTS.md"), initial_agents).unwrap();
    fs::write(
        project.join(".agents/skills/harness/SKILL.md"),
        "---\nname: harness\ndescription: old skill\n---\nold body\n",
    )
    .unwrap();

    // Dry run does not mutate disk.
    let dry = run(
        &["upgrade", "--dry-run", "--json"],
        &project,
        &harness_home,
        &agent_home,
    );
    assert!(dry.status.success(), "{}", stderr(&dry));
    let dry_json: serde_json::Value = serde_json::from_str(&stdout(&dry)).unwrap();
    assert_eq!(dry_json["dry_run"], true);
    assert_eq!(dry_json["agents_updated"], true);
    assert_eq!(dry_json["skill_action"], "updated");
    assert!(fs::read_to_string(project.join("AGENTS.md"))
        .unwrap()
        .contains("Outdated old block text."));

    // Real upgrade refreshes managed block + SKILL.md while preserving project-id & custom text.
    let upg = run(&["upgrade", "--json"], &project, &harness_home, &agent_home);
    assert!(upg.status.success(), "{}", stderr(&upg));
    let upg_json: serde_json::Value = serde_json::from_str(&stdout(&upg)).unwrap();
    assert_eq!(upg_json["agents_updated"], true);
    assert_eq!(upg_json["skill_action"], "updated");

    let upgraded_agents = fs::read_to_string(project.join("AGENTS.md")).unwrap();
    assert!(upgraded_agents.contains("# My Custom Repo Rules"));
    assert!(upgraded_agents.contains("Keep all API responses camelCase."));
    assert!(upgraded_agents.contains("## Extra Footer Notes"));
    assert!(upgraded_agents.contains("Do not drop this custom section."));
    assert!(
        upgraded_agents.contains("<!-- harness-project-id: 0123456789abcdef0123456789abcdef -->")
    );
    assert!(!upgraded_agents.contains("Outdated old block text."));
    assert!(upgraded_agents.contains("Workspace mode & agent skill"));
    assert!(upgraded_agents.contains("harness skill add --global"));

    let upgraded_skill =
        fs::read_to_string(project.join(".agents/skills/harness/SKILL.md")).unwrap();
    assert!(upgraded_skill.contains("Parent workspace mode"));
    assert!(upgraded_skill.contains("harness workspace impact check"));

    let _ = fs::remove_dir_all(&root);
}
