use std::fs;
use std::path::PathBuf;
use std::process::Command;

fn bin() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_harness"))
}

fn run(args: &[&str], cwd: Option<&std::path::Path>) -> std::process::Output {
    let mut cmd = Command::new(bin());
    cmd.args(args);
    if let Some(cwd) = cwd {
        cmd.current_dir(cwd);
    }
    cmd.env("HARNESS_NO_UPDATE_CHECK", "1");
    let home = std::env::temp_dir().join(format!("harness-home-cli-{}", std::process::id()));
    let _ = fs::create_dir_all(&home);
    cmd.env("HARNESS_HOME", &home);
    cmd.output().expect("spawn harness")
}

fn stdout(out: &std::process::Output) -> String {
    String::from_utf8_lossy(&out.stdout).into_owned()
}

fn stderr(out: &std::process::Output) -> String {
    String::from_utf8_lossy(&out.stderr).into_owned()
}

#[test]
fn prints_version_via_long_and_short_flags() {
    let pkg: serde_json::Value = serde_json::from_str(
        &fs::read_to_string(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("package.json"))
            .unwrap(),
    )
    .unwrap();
    let expected = pkg["version"].as_str().unwrap();
    for flag in ["--version", "-V", "-v"] {
        let out = run(&[flag], None);
        assert!(out.status.success(), "{flag}: {}", stderr(&out));
        assert_eq!(stdout(&out).trim(), expected, "{flag}");
    }
}

#[test]
fn help_lists_init_and_product_contract() {
    let out = run(&["--help"], None);
    assert!(out.status.success());
    let text = stdout(&out);
    assert!(text.contains("init"), "{text}");
    assert!(text.contains("migrate"), "{text}");
    assert!(text.contains("Project Link"), "{text}");
    assert!(text.contains("backend reports"), "{text}");
    assert!(!text.contains("create/migrate harness.db"), "{text}");
    assert!(text.contains("register the project"), "{text}");
}

#[test]
fn init_dry_run_and_init_into_temp_dir() {
    let dir = tempfile_dir("harness-e2e-");
    let dry = run(&["init", dir.to_str().unwrap(), "--dry-run"], None);
    assert!(dry.status.success(), "{}", stderr(&dry) + &stdout(&dry));
    assert!(
        stdout(&dry).to_lowercase().contains("dry-run")
            || stdout(&dry).to_lowercase().contains("dry run"),
        "{}",
        stdout(&dry)
    );
    assert!(!dir.join("AGENTS.md").exists());

    let init = run(&["init", "--dir", dir.to_str().unwrap()], None);
    assert!(init.status.success(), "{}", stderr(&init) + &stdout(&init));
    assert!(dir.join("AGENTS.md").exists());
    assert!(dir.join("docs").join("stories").exists());
    assert!(dir.join("docs").join("reports").exists());
    assert!(stdout(&init).contains("Entity dirs: docs/stories|decisions|intakes|backlog|reports"));
    assert!(!dir.join("harness.db").exists());

    let migrate = run(&["migrate", "--dir", dir.to_str().unwrap()], None);
    assert!(
        migrate.status.success(),
        "{}",
        stderr(&migrate) + &stdout(&migrate)
    );
    let mig = stdout(&migrate);
    assert!(
        mig.to_lowercase().contains("markdown")
            || mig.contains("No harness.db")
            || mig.to_lowercase().contains("nothing to migrate"),
        "{mig}"
    );
}

#[test]
fn conflict_without_force_exits_nonzero() {
    let dir = tempfile_dir("harness-e2e-conflict-");
    fs::write(dir.join("AGENTS.md"), "x").unwrap();
    let result = run(&["init", dir.to_str().unwrap()], None);
    assert!(!result.status.success());
    let text = stderr(&result) + &stdout(&result);
    assert!(text.to_lowercase().contains("force"), "{text}");
}

fn tempfile_dir(prefix: &str) -> PathBuf {
    let base = std::env::temp_dir().join(format!(
        "{prefix}{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&base).unwrap();
    base
}
