use std::path::Path;

use crate::domain::enums::{lane_display, proof_display};
use crate::domain::frontmatter::as_string;
use crate::error::{Error, Result};
use crate::infra::table::format_table;

use super::catalog::{build_catalog, by_type, proof01, ProjectCatalog};

pub fn query_matrix(project_root: &Path, numeric: bool) -> Result<String> {
    let cat = build_catalog(project_root)?;
    let rows: Vec<Vec<String>> = by_type(&cat, "story")
        .into_iter()
        .map(|e| {
            vec![
                e.id.clone(),
                e.title.clone(),
                e.status.clone(),
                proof_display(proof01(&e.data, "unit"), numeric),
                proof_display(proof01(&e.data, "integration"), numeric),
                proof_display(proof01(&e.data, "e2e"), numeric),
                proof_display(proof01(&e.data, "platform"), numeric),
                as_string(&e.data, "evidence").unwrap_or_default(),
            ]
        })
        .collect();
    Ok(format_table(
        &rows,
        &["id", "title", "status", "unit", "integ", "e2e", "plat", "evidence"],
    ))
}

pub fn query_stats(project_root: &Path) -> Result<String> {
    let cat = build_catalog(project_root)?;
    let traces = list_traces(project_root);
    let row = vec![vec![
        by_type(&cat, "intake").len().to_string(),
        by_type(&cat, "story").len().to_string(),
        by_type(&cat, "decision").len().to_string(),
        by_type(&cat, "backlog").len().to_string(),
        by_type(&cat, "report").len().to_string(),
        traces.to_string(),
    ]];
    Ok(format!(
        "=== Harness Stats ===\n{}",
        format_table(
            &row,
            &[
                "intakes",
                "stories",
                "decisions",
                "backlog_items",
                "reports",
                "traces"
            ]
        )
    ))
}

pub fn query_stories(project_root: &Path) -> Result<String> {
    let cat = build_catalog(project_root)?;
    let rows: Vec<Vec<String>> = by_type(&cat, "story")
        .into_iter()
        .map(|e| {
            vec![
                e.id.clone(),
                e.title.clone(),
                e.status.clone(),
                lane_display(&as_string(&e.data, "lane").unwrap_or_else(|| "normal".into())),
                as_string(&e.data, "contract").unwrap_or_default(),
            ]
        })
        .collect();
    Ok(format_table(
        &rows,
        &["id", "title", "status", "lane", "contract"],
    ))
}

pub fn query_intakes(project_root: &Path) -> Result<String> {
    let cat = build_catalog(project_root)?;
    let mut items: Vec<_> = by_type(&cat, "intake");
    items.sort_by(|a, b| b.id.cmp(&a.id));
    items.truncate(50);
    let rows: Vec<Vec<String>> = items
        .into_iter()
        .map(|e| {
            vec![
                e.id.clone(),
                if e.status.is_empty() {
                    "pending".into()
                } else {
                    e.status.clone()
                },
                as_string(&e.data, "created_at").unwrap_or_default(),
                as_string(&e.data, "input_type").unwrap_or_default(),
                lane_display(&as_string(&e.data, "lane").unwrap_or_else(|| "normal".into())),
                as_string(&e.data, "summary").unwrap_or_else(|| e.title.clone()),
            ]
        })
        .collect();
    Ok(format_table(
        &rows,
        &[
            "id",
            "status",
            "created_at",
            "input_type",
            "risk_lane",
            "summary",
        ],
    ))
}

pub fn query_decisions(project_root: &Path) -> Result<String> {
    let cat = build_catalog(project_root)?;
    let rows: Vec<Vec<String>> = by_type(&cat, "decision")
        .into_iter()
        .map(|e| {
            vec![
                e.id.clone(),
                e.title.clone(),
                e.status.clone(),
                as_string(&e.data, "doc").unwrap_or_else(|| e.path.clone()),
                as_string(&e.data, "last_verified_at").unwrap_or_default(),
                as_string(&e.data, "last_verified_result").unwrap_or_default(),
            ]
        })
        .collect();
    Ok(format_table(
        &rows,
        &[
            "id",
            "title",
            "status",
            "doc",
            "last_verified_at",
            "last_verified_result",
        ],
    ))
}

pub fn query_backlog(project_root: &Path, filter: &str) -> Result<String> {
    let cat = build_catalog(project_root)?;
    let mut items: Vec<_> = by_type(&cat, "backlog");
    items.retain(|e| match filter {
        "open" => e.status == "proposed" || e.status == "accepted",
        "closed" => e.status == "implemented" || e.status == "rejected",
        _ => true,
    });
    items.sort_by(|a, b| b.id.cmp(&a.id));
    let rows: Vec<Vec<String>> = items
        .into_iter()
        .map(|e| {
            let risk = as_string(&e.data, "risk")
                .map(|r| lane_display(&r))
                .unwrap_or_default();
            vec![
                e.id.clone(),
                e.title.clone(),
                risk,
                e.status.clone(),
                as_string(&e.data, "predicted").unwrap_or_default(),
                as_string(&e.data, "outcome").unwrap_or_default(),
            ]
        })
        .collect();
    Ok(format_table(
        &rows,
        &["id", "title", "risk", "status", "predicted", "outcome"],
    ))
}

pub fn query_reports(project_root: &Path) -> Result<String> {
    let cat = build_catalog(project_root)?;
    let mut items: Vec<_> = by_type(&cat, "report");
    items.sort_by(|a, b| a.id.cmp(&b.id));
    let rows: Vec<Vec<String>> = items
        .into_iter()
        .map(|e| {
            vec![
                e.id.clone(),
                e.status.clone(),
                as_string(&e.data, "severity").unwrap_or_default(),
                as_string(&e.data, "summary").unwrap_or_else(|| e.title.clone()),
                as_string(&e.data, "updated_at").unwrap_or_default(),
            ]
        })
        .collect();
    Ok(format_table(
        &rows,
        &["id", "status", "severity", "summary", "updated_at"],
    ))
}

pub fn query_view(project_root: &Path, view: &str, numeric: bool, open: bool, closed: bool) -> Result<String> {
    match view {
        "matrix" => query_matrix(project_root, numeric),
        "stats" => query_stats(project_root),
        "intakes" => query_intakes(project_root),
        "decisions" => query_decisions(project_root),
        "stories" => query_stories(project_root),
        "backlog" => {
            let filter = if open && !closed {
                "open"
            } else if closed && !open {
                "closed"
            } else {
                "all"
            };
            query_backlog(project_root, filter)
        }
        "traces" => Ok("id  recorded_at  summary\n--  -----------  -------".into()),
        "reports" => query_reports(project_root),
        "tools" => Ok("name  kind  capability  responsibility  status  source\n----  ----  ----------  --------------  ------  ------".into()),
        _ => Err(Error::new(format!(
            "Unknown query view \"{view}\". Use matrix | stats | intakes | decisions | backlog | stories | traces | tools | reports"
        ))),
    }
}

pub fn query_view_json(
    project_root: &Path,
    view: &str,
) -> Result<serde_json::Value> {
    let cat = build_catalog(project_root)?;
    Ok(match view {
        "matrix" => serde_json::to_value(
            by_type(&cat, "story")
                .into_iter()
                .map(|e| {
                    serde_json::json!({
                        "id": e.id,
                        "title": e.title,
                        "status": e.status,
                        "unit": proof01(&e.data, "unit"),
                        "integration": proof01(&e.data, "integration"),
                        "e2e": proof01(&e.data, "e2e"),
                        "platform": proof01(&e.data, "platform"),
                    })
                })
                .collect::<Vec<_>>(),
        )?,
        "stats" => serde_json::json!({
            "intakes": by_type(&cat, "intake").len(),
            "stories": by_type(&cat, "story").len(),
            "decisions": by_type(&cat, "decision").len(),
            "backlog_items": by_type(&cat, "backlog").len(),
            "reports": by_type(&cat, "report").len(),
        }),
        _ => serde_json::to_value(
            by_type(&cat, view.trim_end_matches('s'))
                .into_iter()
                .map(|e| {
                    serde_json::json!({
                        "id": e.id,
                        "title": e.title,
                        "status": e.status,
                        "path": e.path,
                    })
                })
                .collect::<Vec<_>>(),
        )?,
    })
}

fn list_traces(_project_root: &Path) -> usize {
    0
}

pub fn catalog(project_root: &Path) -> Result<ProjectCatalog> {
    build_catalog(project_root)
}
