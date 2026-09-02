use std::path::Path;

use crate::error::Result;
use crate::VERSION;

use super::catalog::{build_catalog, by_type};
use super::index::index_json_path;
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
    lines.push(format!(
        "  result: {}",
        if ok { "healthy" } else { "issues found" }
    ));
    Ok(lines.join("\n"))
}

pub fn format_next(project_root: &Path) -> Result<String> {
    let cat = build_catalog(project_root)?;
    let mut items = Vec::new();
    for e in by_type(&cat, "story") {
        if e.status == "in_progress" || e.status == "blocked" || e.status == "planned" {
            items.push(format!("  [{}] {}  {}", e.status, e.id, e.title));
        }
    }
    for e in by_type(&cat, "report") {
        if e.status == "open" || e.status.is_empty() {
            items.push(format!("  [report] {}  {}", e.id, e.title));
        }
    }
    if items.is_empty() {
        Ok("Next work\n  (no active stories or backend reports)".into())
    } else {
        Ok(format!("Next work\n{}", items.join("\n")))
    }
}

pub fn format_handoff(project_root: &Path) -> Result<String> {
    Ok(format!(
        "Handoff\n{}\n\n{}",
        format_status(project_root)?,
        format_next(project_root)?
    ))
}
