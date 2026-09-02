use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn bin() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_harness"))
}

fn run(args: &[&str], cwd: Option<&Path>) -> std::process::Output {
    let mut cmd = Command::new(bin());
    cmd.args(args);
    if let Some(cwd) = cwd {
        cmd.current_dir(cwd);
    }
    cmd.env("HARNESS_NO_UPDATE_CHECK", "1");
    let home = std::env::temp_dir().join(format!(
        "harness-home-{}",
        std::process::id()
    ));
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

fn tmp(prefix: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "{prefix}{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn init_then_intake_story_decision_backlog_query_search_get() {
    let dir = tmp("harness-dur-cli-");
    let d = dir.to_str().unwrap();

    let init = run(&["init", d], None);
    assert!(init.status.success(), "{}", stderr(&init) + &stdout(&init));

    let intake = run(
        &[
            "intake",
            "--dir",
            d,
            "--type",
            "spec-slice",
            "--summary",
            "phase b",
            "--lane",
            "normal",
            "--story",
            "US-100",
        ],
        None,
    );
    assert!(intake.status.success(), "{}", stderr(&intake) + &stdout(&intake));
    assert!(
        stdout(&intake).contains("Intake IN-001"),
        "{}",
        stdout(&intake)
    );

    let story_add = run(
        &[
            "story", "add", "--dir", d, "--id", "US-100", "--title", "Phase B story", "--lane",
            "normal",
        ],
        None,
    );
    assert!(
        story_add.status.success(),
        "{}",
        stderr(&story_add) + &stdout(&story_add)
    );

    let story_update = run(
        &[
            "story",
            "update",
            "--dir",
            d,
            "--id",
            "US-100",
            "--status",
            "implemented",
            "--unit",
            "1",
            "--integration",
            "1",
            "--e2e",
            "0",
            "--platform",
            "0",
        ],
        None,
    );
    assert!(
        story_update.status.success(),
        "{}",
        stderr(&story_update) + &stdout(&story_update)
    );

    let decision = run(
        &[
            "decision",
            "add",
            "--dir",
            d,
            "--id",
            "0100-test",
            "--title",
            "Test decision",
        ],
        None,
    );
    assert!(
        decision.status.success(),
        "{}",
        stderr(&decision) + &stdout(&decision)
    );

    let backlog = run(
        &[
            "backlog",
            "add",
            "--dir",
            d,
            "--title",
            "Polish help text",
            "--risk",
            "tiny",
        ],
        None,
    );
    assert!(
        backlog.status.success(),
        "{}",
        stderr(&backlog) + &stdout(&backlog)
    );

    let matrix = run(&["query", "matrix", "--dir", d], None);
    assert!(matrix.status.success(), "{}", stderr(&matrix) + &stdout(&matrix));
    assert!(stdout(&matrix).contains("US-100"), "{}", stdout(&matrix));

    let stats = run(&["query", "stats", "--dir", d], None);
    assert!(stats.status.success(), "{}", stderr(&stats) + &stdout(&stats));
    assert!(stdout(&stats).contains("Harness Stats"), "{}", stdout(&stats));

    let search = run(&["search", "Phase B", "--dir", d], None);
    assert!(search.status.success(), "{}", stderr(&search) + &stdout(&search));
    assert!(
        stdout(&search).contains("US-100") || stdout(&search).contains("Phase B"),
        "{}",
        stdout(&search)
    );

    let get = run(&["get", "US-100", "--dir", d], None);
    assert!(get.status.success(), "{}", stderr(&get) + &stdout(&get));
    assert!(stdout(&get).contains("US-100"), "{}", stdout(&get));

    let empty = tmp("harness-empty-q-");
    let empty_matrix = run(&["query", "matrix", "--dir", empty.to_str().unwrap()], None);
    assert!(
        empty_matrix.status.success(),
        "{}",
        stderr(&empty_matrix) + &stdout(&empty_matrix)
    );
}

#[test]
fn shipped_binary_is_not_typescript_cli() {
    let path = bin();
    let name = path.file_name().unwrap().to_string_lossy();
    assert!(
        name.starts_with("harness"),
        "expected harness binary, got {name}"
    );
    assert!(
        !path.to_string_lossy().contains("cli.ts"),
        "{}",
        path.display()
    );
    let bytes = fs::read(&path).unwrap();
    // PE or ELF/Mach-O magic — not a UTF-8 TypeScript source file.
    let is_pe = bytes.len() > 2 && bytes[0] == b'M' && bytes[1] == b'Z';
    let is_elf = bytes.len() > 4 && bytes[0] == 0x7f && bytes[1] == b'E';
    let is_macho = bytes.len() > 4 && (bytes[0] == 0xcf || bytes[0] == 0xca);
    assert!(
        is_pe || is_elf || is_macho,
        "shipped binary is not a native executable: {}",
        path.display()
    );
}
