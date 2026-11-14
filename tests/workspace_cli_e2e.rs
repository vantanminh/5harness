use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static COUNTER: AtomicUsize = AtomicUsize::new(0);

struct TestEnv {
    root: PathBuf,
    home: PathBuf,
}

impl TestEnv {
    fn new(prefix: &str) -> Self {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let base = std::env::temp_dir().join(format!("5h-ws-{prefix}-{ts}-{n}"));
        let root = base.join("ws parent 中文");
        let home = base.join("harness-home");
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&home).unwrap();
        Self { root, home }
    }

    fn bin() -> PathBuf {
        PathBuf::from(env!("CARGO_BIN_EXE_harness"))
    }

    fn run(&self, args: &[&str], cwd: Option<&Path>) -> Output {
        let mut cmd = Command::new(Self::bin());
        cmd.args(args);
        cmd.current_dir(cwd.unwrap_or(&self.root));
        cmd.env("HARNESS_NO_UPDATE_CHECK", "1");
        cmd.env("HARNESS_HOME", &self.home);
        cmd.output().expect("spawn harness")
    }

    fn run_ok(&self, args: &[&str], cwd: Option<&Path>) -> String {
        let out = self.run(args, cwd);
        assert!(
            out.status.success(),
            "command {:?} failed:\nstdout: {}\nstderr: {}",
            args,
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8_lossy(&out.stdout).into_owned()
    }

    fn run_json(&self, args: &[&str], cwd: Option<&Path>) -> serde_json::Value {
        let text = self.run_ok(args, cwd);
        serde_json::from_str(&text)
            .unwrap_or_else(|e| panic!("invalid json from {:?}: {e}\n{text}", args))
    }

    fn init_git(&self, dir: &Path) {
        fs::create_dir_all(dir).unwrap();
        let ok = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(["init", "-q"])
            .status()
            .unwrap()
            .success();
        assert!(ok, "git init failed in {}", dir.display());
        for (k, v) in [
            ("user.email", "test@example.com"),
            ("user.name", "Test User"),
        ] {
            let s = Command::new("git")
                .arg("-C")
                .arg(dir)
                .args(["config", k, v])
                .status()
                .unwrap();
            assert!(s.success());
        }
    }

    fn git_commit_all(&self, dir: &Path, msg: &str) {
        let add = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(["add", "-A"])
            .status()
            .unwrap();
        assert!(add.success());
        let commit = Command::new("git")
            .arg("-C")
            .arg(dir)
            .args(["commit", "-q", "-m", msg])
            .status()
            .unwrap();
        assert!(commit.success());
    }

    fn init_harnessed_repo(&self, name: &str, role: &str) -> PathBuf {
        let dir = self.root.join(name);
        self.init_git(&dir);
        fs::write(dir.join("README.md"), format!("# {name}\n")).unwrap();
        self.run_ok(&["init"], Some(&dir));
        self.run_ok(&["project", "role", "set", role], Some(&dir));
        self.git_commit_all(&dir, "chore: init harness repo");
        dir
    }
}

impl Drop for TestEnv {
    fn drop(&mut self) {
        if let Some(base) = self.root.parent() {
            let _ = fs::remove_dir_all(base);
        }
    }
}

#[test]
fn empty_non_git_workspace_discovery_excludes_noise_and_requires_confirmation() {
    let env = TestEnv::new("empty");
    fs::create_dir_all(env.root.join("node_modules/fake-pkg")).unwrap();
    fs::create_dir_all(env.root.join("target/debug")).unwrap();
    fs::create_dir_all(env.root.join("dist")).unwrap();
    fs::create_dir_all(env.root.join("notes")).unwrap();

    let disc = env.run_json(&["workspace", "discover", "--json"], None);
    assert_eq!(disc["root_is_git"], false);
    assert_eq!(disc["root_is_harnessed"], false);
    assert_eq!(disc["candidates"].as_array().unwrap().len(), 0);

    // Non-interactive link without --yes / --all / --project / --dry-run must fail closed.
    let unconfirmed = env.run(&["workspace", "link"], None);
    assert!(!unconfirmed.status.success());
    assert!(!env.root.join(".5harness").exists());
    assert!(!env.home.join("workspaces.json").exists());

    // --dry-run succeeds without writing workspace or store files.
    let preview = env.run_json(&["workspace", "link", "--dry-run", "--json"], None);
    assert_eq!(preview["dry_run"], true);
    assert!(!env.root.join(".5harness").exists());
    assert!(!env.home.join("workspaces.json").exists());

    // --yes saves empty workspace cleanly without touching workspace directory.
    let linked = env.run_json(&["workspace", "link", "--yes", "--json"], None);
    assert_eq!(linked["dry_run"], false);
    assert!(env.home.join("workspaces.json").is_file());
    assert!(!env.root.join(".5harness").exists());
}

#[test]
fn discovers_worktrees_nested_repos_and_keeps_unharnessed_unmodified() {
    let env = TestEnv::new("worktrees");
    let backend = env.init_harnessed_repo("backend", "backend");

    // Nested git repo inside backend.
    let nested = backend.join("plugins/ext-plugin");
    env.init_git(&nested);
    fs::write(nested.join("lib.rs"), "// nested\n").unwrap();
    env.git_commit_all(&nested, "init nested");

    // Linked Git worktree sharing common dir with backend.
    let wt = env.root.join("backend-wt");
    let ok = Command::new("git")
        .arg("-C")
        .arg(&backend)
        .args(["worktree", "add", "-b", "wt-feat"])
        .arg(&wt)
        .status()
        .unwrap()
        .success();
    assert!(ok, "git worktree add failed");

    // Unharnessed independent git repo.
    let web = env.root.join("web");
    env.init_git(&web);
    fs::write(web.join("package.json"), "{}\n").unwrap();
    env.git_commit_all(&web, "init web");

    let disc = env.run_json(&["workspace", "discover", "--depth", "3", "--json"], None);
    let candidates = disc["candidates"].as_array().unwrap();
    let wt_cand = candidates
        .iter()
        .find(|c| c["relative_path"] == "backend-wt")
        .expect("worktree candidate missing");
    assert_eq!(wt_cand["worktree_duplicate"], true);
    assert_eq!(wt_cand["selected_by_default"], false);

    let nested_cand = candidates
        .iter()
        .find(|c| c["relative_path"] == "backend/plugins/ext-plugin")
        .expect("nested candidate missing");
    assert_eq!(nested_cand["kind"], "nested_repo");
    assert_eq!(nested_cand["selected_by_default"], false);

    // Link default confirmed selection: backend + web (depth=2 default).
    let res = env.run_json(&["workspace", "link", "--yes", "--json"], None);
    let members = res["workspace"]["projects"].as_array().unwrap();
    assert_eq!(members.len(), 2);
    assert!(
        !web.join("AGENTS.md").exists(),
        "must not auto-init unharnessed child"
    );
    assert!(
        !env.root.join(".5harness").exists(),
        "must not pollute parent dir"
    );

    // Re-linking is idempotent.
    let res2 = env.run_json(&["workspace", "link", "--yes", "--json"], None);
    assert_eq!(res2["workspace"]["id"], res["workspace"]["id"]);
    assert_eq!(res2["workspace"]["projects"].as_array().unwrap().len(), 2);

    // Explicitly selecting duplicate worktree fails closed.
    let dup_out = env.run(&["workspace", "link", "--project", "backend-wt"], None);
    assert!(!dup_out.status.success());

    // Explicitly opting into `--project ../outside` traversal fails closed.
    let esc_out = env.run(&["workspace", "link", "--project", ".."], None);
    assert!(!esc_out.status.success());
}

#[test]
fn duplicate_project_id_and_corrupt_store_fail_closed_and_repair_cleanly() {
    let env = TestEnv::new("corrupt");
    let backend = env.init_harnessed_repo("backend", "backend");

    // Duplicate project id in an unrelated git repo.
    let clone_copy = env.root.join("backend copy");
    env.init_git(&clone_copy);
    fs::copy(backend.join("AGENTS.md"), clone_copy.join("AGENTS.md")).unwrap();
    env.git_commit_all(&clone_copy, "copied AGENTS.md");

    let disc = env.run_json(&["workspace", "discover", "--json"], None);
    let copy_cand = disc["candidates"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["relative_path"] == "backend copy")
        .unwrap();
    assert!(copy_cand["duplicate_id_with"].is_string());
    assert_eq!(copy_cand["selected_by_default"], false);

    // Explicit link of both backend and duplicate id repo fails closed.
    let conflict = env.run(
        &[
            "workspace",
            "link",
            "--project",
            "backend",
            "--project",
            "backend copy",
        ],
        None,
    );
    assert!(!conflict.status.success());

    // Corrupt store fails closed without deleting user data.
    fs::write(env.home.join("workspaces.json"), "{broken json").unwrap();
    let bad_status = env.run(&["workspace", "status"], None);
    assert!(!bad_status.status.success());
    let stderr_text = String::from_utf8_lossy(&bad_status.stderr);
    assert!(
        stderr_text.contains("doctor --repair"),
        "expected repair hint in: {stderr_text}"
    );

    // Unsupported version fails closed.
    fs::write(
        env.home.join("workspaces.json"),
        r#"{"version":99,"workspaces":[]}"#,
    )
    .unwrap();
    let bad_ver = env.run(&["workspace", "doctor"], None);
    assert!(!bad_ver.status.success());

    // `doctor --repair` backs up and restores valid empty store.
    let repaired = env.run_json(&["workspace", "doctor", "--repair", "--json"], None);
    assert_eq!(repaired["repaired"], true);
    let bak = repaired["backup_path"].as_str().unwrap();
    assert!(Path::new(bak).is_file());
    let healthy = env.run_json(&["workspace", "doctor", "--json"], None);
    assert_eq!(healthy["healthy"], true);
}

#[test]
fn partial_failure_resilient_context_and_reconcile_moved_repo() {
    let env = TestEnv::new("reconcile");
    let backend = env.init_harnessed_repo("backend", "backend");
    let web = env.init_harnessed_repo("web", "frontend");

    env.run_ok(
        &[
            "story",
            "add",
            "--id",
            "US-001",
            "--title",
            "Add OAuth endpoint",
            "--lane",
            "normal",
            "--contract",
            "POST /oauth/token",
        ],
        Some(&backend),
    );
    env.run_ok(&["workspace", "link", "--yes"], None);

    // Move `web` into `apps/web-portal` and corrupt `backend`'s index.json.
    fs::create_dir_all(env.root.join("apps")).unwrap();
    fs::rename(&web, env.root.join("apps/web-portal")).unwrap();
    fs::write(backend.join(".5harness/index/index.json"), "{corrupt").unwrap();

    // Status and bounded context still succeed partially without losing backend or crashing.
    let status = env.run_json(&["workspace", "status", "--json"], None);
    assert_eq!(status["summary"]["members_degraded"], 2);
    let members = status["members"].as_array().unwrap();
    assert_eq!(
        members.iter().find(|m| m["name"] == "backend").unwrap()["index"],
        "corrupt"
    );
    assert_eq!(
        members.iter().find(|m| m["name"] == "web").unwrap()["status"],
        "missing"
    );

    let ctx = env.run_json(
        &[
            "workspace",
            "context",
            "--task",
            "OAuth",
            "--role",
            "backend",
            "--max-chars",
            "1500",
            "--json",
        ],
        None,
    );
    assert_eq!(ctx["projects"].as_array().unwrap().len(), 1);
    assert_eq!(ctx["projects"][0]["stories"][0]["id"], "US-001");

    // Reconcile automatically relinks moved `apps/web-portal` by project_id.
    let rec = env.run_json(&["workspace", "reconcile", "--depth", "3", "--json"], None);
    assert_eq!(rec["relinked"].as_array().unwrap().len(), 1);
    assert_eq!(rec["missing"].as_array().unwrap().len(), 0);

    let status_after = env.run_json(&["workspace", "status", "--json"], None);
    let web_after = status_after["members"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["name"] == "web")
        .unwrap();
    assert_eq!(web_after["relative_path"], "apps/web-portal");
    assert_eq!(web_after["status"], "ok");
}

#[test]
fn hybrid_impact_check_reports_and_story_completion_gate() {
    let env = TestEnv::new("impacts");
    let backend = env.init_harnessed_repo("backend", "backend");
    let web = env.init_harnessed_repo("web", "frontend");
    let _mobile = env.init_harnessed_repo("mobile", "mobile");

    env.run_ok(&["workspace", "link", "--yes"], None);

    // Declare dependencies; verify cycle detection.
    env.run_ok(
        &[
            "workspace",
            "dep",
            "add",
            "--from",
            "backend",
            "--to",
            "web",
            "--kind",
            "api_contract",
            "--contract-path",
            "openapi/",
        ],
        None,
    );
    env.run_ok(
        &[
            "workspace",
            "dep",
            "add",
            "--from",
            "backend",
            "--to",
            "mobile",
            "--kind",
            "api_contract",
            "--contract-path",
            "openapi/",
            "--optional",
        ],
        None,
    );
    let cycle = env.run(
        &[
            "workspace",
            "dep",
            "add",
            "--from",
            "web",
            "--to",
            "backend",
        ],
        None,
    );
    assert!(!cycle.status.success());

    // Create a contract story in backend and touch contract + contract-like route files.
    env.run_ok(
        &[
            "story",
            "add",
            "--id",
            "US-001",
            "--title",
            "Versioned login API",
            "--lane",
            "normal",
            "--contract",
            "POST /v2/login",
        ],
        Some(&backend),
    );
    env.run_ok(&["story", "start", "US-001"], Some(&backend));
    fs::create_dir_all(backend.join("openapi")).unwrap();
    fs::write(backend.join("openapi/auth.yaml"), "openapi: 3.1.0\n").unwrap();
    fs::create_dir_all(backend.join("src/routes")).unwrap();
    fs::write(backend.join("src/routes/login.ts"), "export {}\n").unwrap();

    // Story done MUST fail closed before impact check is recorded.
    let blocked_early = env.run(&["story", "done", "US-001"], Some(&backend));
    assert!(!blocked_early.status.success());
    let early_err = String::from_utf8_lossy(&blocked_early.stderr);
    assert!(
        early_err.contains("impact gate"),
        "expected impact gate error, got: {early_err}"
    );

    // Run impact check --create --emit-reports from workspace root.
    let check = env.run_json(
        &[
            "workspace",
            "impact",
            "check",
            "--source",
            "backend",
            "--story",
            "US-001",
            "--create",
            "--emit-reports",
            "--json",
        ],
        None,
    );
    assert_eq!(check["obligations"].as_array().unwrap().len(), 2);
    assert!(
        !check["emitted_reports"].as_array().unwrap().is_empty(),
        "expected target-owned report emitted to web/mobile"
    );
    assert!(web.join("docs/reports/RP-001.md").is_file());
    assert!(
        !check["advisory_suggestions"].as_array().unwrap().is_empty(),
        "expected advisory suggestion for unmapped src/routes/login.ts"
    );

    // Idempotent second run must not duplicate IMP or RP files.
    let check2 = env.run_json(
        &[
            "workspace",
            "impact",
            "check",
            "--source",
            "backend",
            "--story",
            "US-001",
            "--create",
            "--emit-reports",
            "--json",
        ],
        None,
    );
    assert_eq!(check2["emitted_reports"].as_array().unwrap().len(), 0);
    assert!(!web.join("docs/reports/RP-002.md").exists());

    // Story done MUST still fail closed while required impact on `web` is `pending`.
    let blocked_pending = env.run(&["story", "done", "US-001"], Some(&backend));
    assert!(!blocked_pending.status.success());

    let impacts = env.run_json(&["workspace", "impact", "list", "--json"], None);
    let web_imp_id = impacts
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["target_member"] == "web")
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Waiver or no_change_needed without reason MUST fail closed.
    let no_reason = env.run(
        &[
            "workspace",
            "impact",
            "update",
            &web_imp_id,
            "--status",
            "waived",
        ],
        None,
    );
    assert!(!no_reason.status.success());

    // Resolve required obligation with reason; optional mobile stays pending and should NOT block.
    env.run_ok(
        &[
            "workspace",
            "impact",
            "update",
            &web_imp_id,
            "--status",
            "updated",
            "--note",
            "Updated web auth client for /v2/login",
        ],
        None,
    );

    let gate = env.run_json(
        &[
            "workspace",
            "impact",
            "gate",
            "US-001",
            "--source",
            "backend",
            "--json",
        ],
        None,
    );
    assert_eq!(gate["passed"], true);

    env.run_ok(&["story", "done", "US-001"], Some(&backend));
    let story_json = env.run_json(&["get", "US-001", "--json"], Some(&backend));
    assert_eq!(story_json["status"], "implemented");

    // Verify manifest export/apply portability and path traversal rejection.
    env.run_ok(
        &[
            "workspace",
            "manifest",
            "export",
            "--out",
            "ws-manifest.json",
        ],
        None,
    );
    env.run_ok(&["workspace", "unlink"], None);
    let applied = env.run_json(
        &[
            "workspace",
            "manifest",
            "apply",
            "--file",
            "ws-manifest.json",
            "--json",
        ],
        None,
    );
    assert_eq!(applied["projects"].as_array().unwrap().len(), 3);
    assert_eq!(applied["dependencies"].as_array().unwrap().len(), 2);

    fs::write(
        env.root.join("evil-manifest.json"),
        r#"{"version":1,"name":"bad","members":[{"name":"esc","relative_path":"../outside"}]}"#,
    )
    .unwrap();
    let bad_manifest = env.run(
        &[
            "workspace",
            "manifest",
            "apply",
            "--file",
            "evil-manifest.json",
        ],
        None,
    );
    assert!(!bad_manifest.status.success());
}

#[test]
fn peer_write_roots_blocks_unauthorized_report_and_context_honors_budget() {
    let env = TestEnv::new("roots-budget");
    let backend = env.init_harnessed_repo("backend", "backend");
    let web = env.init_harnessed_repo("web", "frontend");

    for idx in 1..=6 {
        let id = format!("US-{idx:03}");
        let title =
            format!("Long story title number {idx} for bounded context budget verification");
        env.run_ok(
            &[
                "story", "add", "--id", &id, "--title", &title, "--lane", "normal",
            ],
            Some(&backend),
        );
    }

    env.run_ok(&["workspace", "link", "--yes"], None);
    env.run_ok(
        &[
            "workspace",
            "dep",
            "add",
            "--from",
            "backend",
            "--to",
            "web",
            "--kind",
            "api_contract",
        ],
        None,
    );
    env.run_ok(
        &[
            "story",
            "add",
            "--id",
            "US-099",
            "--title",
            "Contract change",
            "--lane",
            "normal",
            "--contract",
            "GET /v2/me",
        ],
        Some(&backend),
    );
    env.run_ok(&["story", "start", "US-099"], Some(&backend));

    // Set HARNESS_PEER_WRITE_ROOTS to backend ONLY so report emission into `web` is blocked cleanly.
    let mut cmd = Command::new(TestEnv::bin());
    cmd.args([
        "workspace",
        "impact",
        "check",
        "--source",
        "backend",
        "--story",
        "US-099",
        "--create",
        "--emit-reports",
        "--json",
    ]);
    cmd.current_dir(&env.root);
    cmd.env("HARNESS_NO_UPDATE_CHECK", "1");
    cmd.env("HARNESS_HOME", &env.home);
    cmd.env("HARNESS_PEER_WRITE_ROOTS", &backend);
    let out = cmd.output().unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
    let val: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(val["emitted_reports"].as_array().unwrap().len(), 0);
    assert!(
        val["warnings"].as_array().unwrap().iter().any(|w| w
            .as_str()
            .is_some_and(|s| s.contains("HARNESS_PEER_WRITE_ROOTS"))),
        "expected HARNESS_PEER_WRITE_ROOTS warning: {val}"
    );
    assert!(!web.join("docs/reports/RP-001.md").exists());

    // Bounded text context strictly honors max-chars.
    let txt = env.run_ok(&["workspace", "context", "--max-chars", "550"], None);
    assert!(txt.chars().count() <= 550, "len={}", txt.chars().count());

    // Bounded JSON context marks truncated when payload exceeds budget.
    let bounded = env.run_json(
        &["workspace", "context", "--max-chars", "550", "--json"],
        None,
    );
    assert_eq!(bounded["truncated"], true);
}
