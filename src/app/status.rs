use std::path::Path;

use serde_json::{json, Value};

use crate::error::Result;
use crate::VERSION;

use super::catalog::{build_catalog, by_type};
use super::index::{checksum_valid, ensure_index, index_json_path};
use super::project_link;
use super::query::query_stats;

pub fn format_status(project_root: &Path) -> Result<String> {
    let cat = build_catalog(project_root)?;
    let index_exists = index_json_path(project_root).exists();
    let stats = query_stats(project_root)?;
    Ok(format!(
        "Harness status  v{VERSION}\nproject: {}\nindex: {}\nstories: {}  decisions: {}  intakes: {}  backlog: {}\n\n{stats}",
        project_root.display(),
        if index_exists { "present" } else { "missing (run harness reindex)" },
        by_type(&cat, "story").len(),
        by_type(&cat, "decision").len(),
        by_type(&cat, "intake").len(),
        by_type(&cat, "backlog").len(),
    ))
}

pub fn format_doctor(project_root: &Path) -> Result<String> {
    let mut ok = true;
    let mut lines = vec!["Harness doctor".to_string()];
    let agents = project_root.join("AGENTS.md");
    if agents.exists() {
        lines.push("  AGENTS.md: ok".into());
    } else {
        lines.push("  AGENTS.md: missing — run harness init".into());
        ok = false;
    }
    for dir in [
        "docs/stories",
        "docs/decisions",
        "docs/intakes",
        "docs/backlog",
        "docs/reports",
    ] {
        if project_root.join(dir).is_dir() {
            lines.push(format!("  {dir}: ok"));
        } else {
            lines.push(format!("  {dir}: missing"));
            ok = false;
        }
    }
    if index_json_path(project_root).is_file() {
        lines.push("  index: present".into());
    } else {
        lines.push("  index: missing — run harness reindex".into());
        ok = false;
    }
    let linked = crate::infra::registry::read_registry().projects.iter().any(|p| {
        Path::new(&p.path).canonicalize().ok() == project_root.canonicalize().ok()
    });
    if linked { lines.push("  registry: linked".into()); }
    else { lines.push("  registry: missing — run harness link".into()); ok = false; }
    lines.push(format!(
        "  result: {}",
        if ok { "healthy" } else { "issues found" }
    ));
    Ok(lines.join("\n"))
}

pub fn doctor_json(project_root: &Path) -> Result<Value> {
    let mut checks = serde_json::Map::new();
    let agents_ok = project_root.join("AGENTS.md").is_file();
    checks.insert("agents".into(), json!({"ok": agents_ok, "path": "AGENTS.md"}));
    for dir in [
        "docs/stories",
        "docs/decisions",
        "docs/intakes",
        "docs/backlog",
        "docs/reports",
    ] {
        let ok = project_root.join(dir).is_dir();
        checks.insert(dir.replace('/', "_"), json!({"ok": ok, "path": dir}));
    }
    let index_path = index_json_path(project_root);
    let index_result = if index_path.exists() { ensure_index(project_root) } else { Err(crate::error::Error::new("index missing")) };
    let index_ok = index_result.is_ok();
    checks.insert("index".into(), json!({"ok": index_ok, "fresh": index_result.as_ref().map(|idx| index_is_fresh(project_root, idx)).unwrap_or(false), "path": index_path}));
    let registry_ok = crate::infra::registry::read_registry().projects.iter().any(|p| {
        Path::new(&p.path).canonicalize().ok() == project_root.canonicalize().ok()
    });
    checks.insert("registry".into(), json!({"ok": registry_ok, "linked": registry_ok}));
    let healthy = checks.values().all(|v| v.get("ok").and_then(Value::as_bool).unwrap_or(false));
    Ok(json!({
        "healthy": healthy,
        "project": project_root,
        "version": VERSION,
        "checks": checks,
    }))
}

pub fn status_json(project_root: &Path) -> Result<Value> {
    let cat = build_catalog(project_root)?;
    let index = ensure_index(project_root)?;
    let role = project_link::role(project_root).unwrap_or_else(|_| json!({"role":null,"stack":[]}));
    let peers = project_link::peers(project_root).unwrap_or_default();
    Ok(json!({
        "version": VERSION,
        "project": project_root,
        "index": {
            "present": index_json_path(project_root).exists(),
            "fresh": index_is_fresh(project_root, &index),
            "built_at": index.built_at,
            "entities": index.catalog.len(),
            "edges": index.edges.len(),
        },
        "counts": {
            "stories": by_type(&cat, "story").len(),
            "decisions": by_type(&cat, "decision").len(),
            "intakes": by_type(&cat, "intake").len(),
            "backlog_items": by_type(&cat, "backlog").len(),
            "reports": by_type(&cat, "report").len(),
        },
        "project_link": {
            "role": role["role"],
            "stack": role["stack"],
            "peers": peers,
            "open_reports": by_type(&cat, "report").iter().filter(|e| e.status == "open" || e.status.is_empty()).count(),
        },
    }))
}

pub fn format_next(project_root: &Path) -> Result<String> {
    let items = next_items(project_root, None)?;
    if items.is_empty() {
        Ok("Next work\n  (no active stories or backend reports)".into())
    } else {
        Ok(format!("Next work\n{}", items.iter().map(|item| format!("  [{}] {}  {}", item["kind"].as_str().unwrap_or("work"), item["id"].as_str().unwrap_or(""), item["title"].as_str().unwrap_or(""))).collect::<Vec<_>>().join("\n")))
    }
}

pub fn next_items(project_root: &Path, limit: Option<usize>) -> Result<Vec<Value>> {
    let cat = build_catalog(project_root)?;
    let mut items = Vec::new();
    for e in by_type(&cat, "report") {
        if e.status == "open" || e.status.is_empty() {
            items.push(json!({"kind":"report","id":e.id,"title":e.title,"status":e.status,"priority":0}));
        }
    }
    for e in by_type(&cat, "story") {
        if matches!(e.status.as_str(), "in_progress" | "blocked" | "planned") {
            let priority = match e.status.as_str() { "in_progress" => 1, "blocked" => 2, _ => 3 };
            items.push(json!({"kind":"story","id":e.id,"title":e.title,"status":e.status,"priority":priority}));
        }
    }
    for e in by_type(&cat, "intake") {
        if e.status.is_empty() || e.status == "pending" {
            items.push(json!({"kind":"intake","id":e.id,"title":e.title,"status":e.status,"priority":4}));
        }
    }
    for e in by_type(&cat, "backlog") {
        if e.status == "proposed" || e.status == "accepted" {
            items.push(json!({"kind":"backlog","id":e.id,"title":e.title,"status":e.status,"priority":5}));
        }
    }
    items.sort_by(|a, b| {
        a["priority"].as_i64().unwrap_or(99)
            .cmp(&b["priority"].as_i64().unwrap_or(99))
            .then_with(|| a["id"].as_str().unwrap_or("").cmp(b["id"].as_str().unwrap_or("")))
    });
    if let Some(limit) = limit {
        items.truncate(limit);
    }
    Ok(items)
}

fn index_is_fresh(project_root: &Path, index: &super::index::ProjectIndex) -> bool {
    let Ok(cat) = build_catalog(project_root) else { return false };
    if !checksum_valid(index) || index.project_root != project_root.to_string_lossy() || index.catalog.len() != cat.entries.len() {
        return false;
    }
    cat.entries.iter().all(|entry| {
        index.catalog.iter().any(|row| {
            row.id == entry.id && row.path == entry.path && row.ty == entry.ty && row.mtime_ms == entry.mtime_ms
        })
    })
}

pub fn format_handoff(project_root: &Path) -> Result<String> {
    Ok(format!(
        "Handoff\n{}\n\n{}",
        format_status(project_root)?,
        format_next(project_root)?
    ))
}
