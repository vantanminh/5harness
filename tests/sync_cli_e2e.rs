use std::fs;
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use harness::app::auth::AuthState;
use harness::app::sync::{run_pull, run_push};
use serde_json::{json, Value};

static HOME_LOCK: Mutex<()> = Mutex::new(());

#[test]
fn encrypted_push_and_pull_round_trip_through_cloud_api_shape() {
    let _guard = HOME_LOCK.lock().unwrap();
    let root = temp_dir("push");
    let clone = temp_dir("pull");
    prepare_project(&root, "Project one");
    prepare_project(&clone, "Local clone");
    fs::write(root.join("docs/stories/US-001.md"), "# Cloud story\n").unwrap();

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let posted = Arc::new(Mutex::new(None::<Value>));
    let posted_for_server = posted.clone();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let (path, body) = read_request(&mut stream);
        assert_eq!(path, "/api/sync/snapshots");
        let payload: Value = serde_json::from_str(&body).unwrap();
        assert!(!body.contains("a long enough passphrase"));
        assert!(!body.contains("refresh-token-secret"));
        assert_eq!(payload["commit"]["changed_paths"][0]["change"], "added");
        assert_eq!(
            payload["commit"]["changed_paths"][0]["path"],
            "docs/stories/US-001.md"
        );
        assert_eq!(payload["catalog"]["project_id"], "project-1234567890");
        assert!(
            payload["catalog"]["entities"].as_array().is_some(),
            "{payload}"
        );
        *posted_for_server.lock().unwrap() = Some(payload.clone());
        let envelope = payload["envelope"].clone();
        write_json(
            &mut stream,
            200,
            &json!({
                "snapshot_id": payload["project_id"],
                "revision": "revision-one",
                "created_at": "2026-01-01T00:00:00.000Z",
                "plaintext_sha256": envelope["plaintext_sha256"],
                "ciphertext_bytes": envelope["ciphertext_base64"].as_str().unwrap().len()
            }),
        );

        let (mut stream, _) = listener.accept().unwrap();
        let (path, _) = read_request(&mut stream);
        assert_eq!(path, "/api/sync/snapshots/project-1234567890");
        let envelope = posted_for_server.lock().unwrap().as_ref().unwrap()["envelope"].clone();
        write_json(
            &mut stream,
            200,
            &json!({
                "has_snapshot": true,
                "project_id": "project-1234567890",
                "revision": "revision-one",
                "created_at": "2026-01-01T00:00:00.000Z",
                "updated_at": "2026-01-01T00:00:00.000Z",
                "envelope": envelope
            }),
        );
    });

    let home = temp_dir("home");
    fs::write(
        home.join("auth.json"),
        serde_json::to_string(&AuthState {
            server: format!("http://{}", address),
            access_token: "access-token-secret".into(),
            access_expires_at: i64::MAX,
            refresh_token: "refresh-token-secret".into(),
            refresh_expires_at: None,
            user_id: Some("user-1".into()),
            user_email: Some("user@example.com".into()),
            created_at: 1,
            updated_at: 1,
        })
        .unwrap(),
    )
    .unwrap();
    std::env::set_var("HARNESS_HOME", &home);

    let pushed = run_push(&root, Some("a long enough passphrase"), false).unwrap();
    assert_eq!(pushed.revision.as_deref(), Some("revision-one"));
    assert_eq!(pushed.files, 1);
    let pulled = run_pull(
        &clone,
        Some("a long enough passphrase"),
        false,
        false,
        false,
    )
    .unwrap();
    assert_eq!(pulled.revision.as_deref(), Some("revision-one"));
    assert_eq!(
        fs::read_to_string(clone.join("docs/stories/US-001.md")).unwrap(),
        "# Cloud story\n"
    );
    server.join().unwrap();
}

#[test]
fn second_push_sends_only_changed_paths_and_plan_token_round_trips() {
    use harness::app::plan::{fetch_plan, handoff_command, parse_handoff_token};
    let _guard = HOME_LOCK.lock().unwrap();

    let root = temp_dir("push-delta");
    prepare_project(&root, "Project two");
    fs::write(root.join("docs/stories/US-001.md"), "# Cloud story\n").unwrap();

    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let posted = Arc::new(Mutex::new(Vec::<Value>::new()));
    let posted_for_server = posted.clone();
    let server = thread::spawn(move || {
        for index in 0..2 {
            let (mut stream, _) = listener.accept().unwrap();
            let (path, body) = read_request(&mut stream);
            assert_eq!(path, "/api/sync/snapshots");
            let payload: Value = serde_json::from_str(&body).unwrap();
            posted_for_server.lock().unwrap().push(payload.clone());
            write_json(
                &mut stream,
                200,
                &json!({
                    "snapshot_id": "project-1234567890",
                    "revision": format!("revision-{}", index + 1),
                    "created_at": "2026-01-01T00:00:00.000Z",
                    "plaintext_sha256": payload["envelope"]["plaintext_sha256"],
                    "ciphertext_bytes": 32,
                    "commit_id": payload["commit"]["id"]
                }),
            );
        }
        let (mut stream, _) = listener.accept().unwrap();
        let (path, _) = read_request(&mut stream);
        assert_eq!(path, "/api/plans/kfkadjakdnjkad");
        write_json(
            &mut stream,
            200,
            &json!({
                "token": "kfkadjakdnjkad",
                "project_id": "project-1234567890",
                "title": "Export API",
                "idea": "Add export",
                "research_notes": "Checked similar CLIs",
                "plan_markdown": "1. Add route\n2. Test",
                "implement_prompt": "Implement the export API as specified in this brief.",
                "handoff_command": "please implement plan from harness --kfkadjakdnjkad",
                "created_at": "2026-09-16T00:00:00.000Z"
            }),
        );
    });

    let home = temp_dir("home-delta");
    fs::write(
        home.join("auth.json"),
        serde_json::to_string(&AuthState {
            server: format!("http://{}", address),
            access_token: "access-token-secret".into(),
            access_expires_at: i64::MAX,
            refresh_token: "refresh-token-secret".into(),
            refresh_expires_at: None,
            user_id: Some("user-1".into()),
            user_email: Some("user@example.com".into()),
            created_at: 1,
            updated_at: 1,
        })
        .unwrap(),
    )
    .unwrap();
    std::env::set_var("HARNESS_HOME", &home);

    let first = run_push(&root, Some("a long enough passphrase"), false).unwrap();
    assert!(first.commit_id.is_some(), "{first:?}");
    fs::write(
        root.join("docs/stories/US-001.md"),
        "# Cloud story changed\n",
    )
    .unwrap();
    let second = run_push(&root, Some("a long enough passphrase"), false).unwrap();
    let payloads = posted.lock().unwrap().clone();
    assert_eq!(payloads.len(), 2, "{payloads:?}");
    let second_changes = payloads[1]["commit"]["changed_paths"].as_array().unwrap();
    assert_eq!(second_changes.len(), 1, "{second_changes:?}");
    assert_eq!(second_changes[0]["path"], "docs/stories/US-001.md");
    assert_eq!(second_changes[0]["change"], "modified");
    assert_eq!(
        second.commit_id.as_deref(),
        payloads[1]["commit"]["id"].as_str()
    );

    assert_eq!(
        parse_handoff_token(&handoff_command("kfkadjakdnjkad")).unwrap(),
        "kfkadjakdnjkad"
    );
    let plan = fetch_plan("please implement plan from harness --kfkadjakdnjkad").unwrap();
    assert_eq!(plan.token, "kfkadjakdnjkad");
    assert!(plan.implement_prompt.contains("Implement the export API"));
    assert!(plan.plan_markdown.contains("Add route"));
    server.join().unwrap();
}

fn prepare_project(root: &Path, name: &str) {
    for directory in [
        "docs/stories",
        "docs/decisions",
        "docs/intakes",
        "docs/backlog",
        "docs/reports",
    ] {
        fs::create_dir_all(root.join(directory)).unwrap();
    }
    fs::write(
        root.join("AGENTS.md"),
        format!(
            "<!-- HARNESS:BEGIN -->\n<!-- harness-version: 0.25.3 -->\n<!-- harness-project-id: project-1234567890 -->\n<!-- HARNESS:END -->\n# {name}\n"
        ),
    )
    .unwrap();
}

fn read_request(stream: &mut TcpStream) -> (String, String) {
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    let mut bytes = Vec::new();
    let mut chunk = [0u8; 4096];
    let header_end;
    loop {
        let count = stream.read(&mut chunk).unwrap();
        assert!(count > 0);
        bytes.extend_from_slice(&chunk[..count]);
        if let Some(index) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
            header_end = index + 4;
            break;
        }
    }
    let head = String::from_utf8_lossy(&bytes[..header_end]).into_owned();
    let length = head
        .lines()
        .find_map(|line| {
            line.strip_prefix("Content-Length: ")
                .or_else(|| line.strip_prefix("content-length: "))
        })
        .and_then(|value| value.trim().parse::<usize>().ok())
        .unwrap_or(0);
    while bytes.len() - header_end < length {
        let count = stream.read(&mut chunk).unwrap();
        bytes.extend_from_slice(&chunk[..count]);
    }
    let target = head.split_whitespace().nth(1).unwrap().to_string();
    let body = String::from_utf8_lossy(&bytes[header_end..header_end + length]).into_owned();
    (target, body)
}

fn write_json(stream: &mut TcpStream, status: u16, body: &Value) {
    let payload = serde_json::to_string(body).unwrap();
    let status_text = if status == 200 { "OK" } else { "Error" };
    write!(
        stream,
        "HTTP/1.1 {status} {status_text}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        payload.len(),
        payload
    )
    .unwrap();
    stream.flush().unwrap();
}

fn temp_dir(label: &str) -> PathBuf {
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let path = std::env::temp_dir().join(format!("harness-cloud-{label}-{suffix}"));
    fs::create_dir_all(&path).unwrap();
    path
}
