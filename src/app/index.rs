use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::domain::paths::project_index_dir;
use crate::domain::wikilinks::{extract_wikilinks, match_link_target, normalize_link_target};
use crate::error::Result;
use crate::infra::entities::{atomic_write, read_entity_file};

use super::catalog::{build_catalog, links_of};

pub const INDEX_SCHEMA_VERSION: u32 = 1;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct IndexCatalogRow {
    pub id: String,
    #[serde(rename = "type")]
    pub ty: String,
    pub path: String,
    pub title: String,
    pub status: String,
    #[serde(rename = "mtimeMs")]
    pub mtime_ms: u128,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct IndexEdge {
    pub from: String,
    pub to: String,
    pub kind: String,
    pub resolved: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProjectIndex {
    pub version: u32,
    pub built_at: String,
    #[serde(rename = "projectRoot")]
    pub project_root: String,
    pub catalog: Vec<IndexCatalogRow>,
    pub edges: Vec<IndexEdge>,
    pub texts: serde_json::Map<String, serde_json::Value>,
    #[serde(default)]
    pub checksum: Option<String>,
}

pub fn index_json_path(project_root: &Path) -> PathBuf {
    project_index_dir(project_root).join("index.json")
}

pub fn build_project_index(project_root: &Path) -> Result<ProjectIndex> {
    let catalog = build_catalog(project_root)?;
    let rows: Vec<IndexCatalogRow> = catalog
        .entries
        .iter()
        .map(|e| IndexCatalogRow {
            id: e.id.clone(),
            ty: e.ty.clone(),
            path: e.path.clone(),
            title: e.title.clone(),
            status: e.status.clone(),
            mtime_ms: e.mtime_ms,
        })
        .collect();
    let lite: Vec<(String, String, String)> = catalog
        .entries
        .iter()
        .map(|e| (e.id.clone(), e.path.clone(), e.ty.clone()))
        .collect();
    let mut edges = Vec::new();
    let mut texts = serde_json::Map::new();
    for e in &catalog.entries {
        let body = read_entity_file(project_root, &e.path)?
            .map(|f| f.body)
            .unwrap_or_default();
        let fm_blob = e
            .data
            .iter()
            .map(|(key, value)| format!("{key}={value:?}"))
            .collect::<Vec<_>>()
            .join(" ");
        texts.insert(
            e.id.clone(),
            serde_json::Value::String(format!("{fm_blob}\n{body}")),
        );
        for link in links_of(&e.data) {
            let target = normalize_link_target(&link);
            let matched = match_link_target(&target, &lite);
            edges.push(IndexEdge {
                from: e.id.clone(),
                to: matched.map(|m| m.0.clone()).unwrap_or(target),
                kind: "frontmatter".into(),
                resolved: matched.is_some(),
            });
        }
        for wl in extract_wikilinks(&body) {
            let matched = match_link_target(&wl, &lite);
            edges.push(IndexEdge {
                from: e.id.clone(),
                to: matched.map(|m| m.0.clone()).unwrap_or(wl),
                kind: "wikilink".into(),
                resolved: matched.is_some(),
            });
        }
    }
    Ok(ProjectIndex {
        version: INDEX_SCHEMA_VERSION,
        built_at: chrono::Utc::now().to_rfc3339(),
        project_root: project_root.to_string_lossy().into_owned(),
        catalog: rows,
        edges,
        texts,
        checksum: None,
    })
}

pub fn write_project_index(project_root: &Path) -> Result<(PathBuf, usize, usize)> {
    let mut index = build_project_index(project_root)?;
    index.checksum = Some(checksum_for(&index)?);
    let path = index_json_path(project_root);
    let payload = format!("{}\n", serde_json::to_string_pretty(&index)?);
    atomic_write(&path, &payload)?;
    Ok((path, index.catalog.len(), index.edges.len()))
}

pub fn ensure_index(project_root: &Path) -> Result<ProjectIndex> {
    let path = index_json_path(project_root);
    if path.exists() {
        if let Ok(raw) = std::fs::read_to_string(&path) {
            if let Ok(idx) = serde_json::from_str::<ProjectIndex>(&raw) {
                let current = build_project_index(project_root)?;
                let checksum_valid = idx.checksum.as_deref() == Some(checksum_for(&idx)?.as_str());
                let fresh = checksum_valid && idx.version == INDEX_SCHEMA_VERSION
                    && idx.project_root == project_root.to_string_lossy()
                    && idx.catalog.len() == current.catalog.len()
                    && idx.catalog.iter().all(|row| {
                        current.catalog.iter().any(|candidate| {
                            row.id == candidate.id
                                && row.path == candidate.path
                                && row.ty == candidate.ty
                                && row.mtime_ms == candidate.mtime_ms
                        })
                    });
                if fresh {
                    return Ok(idx);
                }
            }
        }
    }
    let mut built = build_project_index(project_root)?;
    built.checksum = Some(checksum_for(&built)?);
    write_project_index(project_root)?;
    Ok(built)
}

pub fn checksum_valid(index: &ProjectIndex) -> bool {
    index.checksum.as_deref().and_then(|stored| checksum_for(index).ok().map(|computed| stored == computed)).unwrap_or(false)
}

fn checksum_for(index: &ProjectIndex) -> Result<String> {
    let mut copy = index.clone();
    copy.checksum = None;
    let raw = serde_json::to_vec(&copy)?;
    let mut hasher = Sha256::new();
    hasher.update(raw);
    Ok(hex::encode(hasher.finalize()))
}

#[derive(Clone, Debug, Serialize)]
pub struct SearchHit {
    pub id: String,
    pub ty: String,
    pub path: String,
    pub title: String,
    pub snippet: String,
    pub score: usize,
}

pub fn search_index(
    index: &ProjectIndex,
    query: &str,
    limit: usize,
    ty: Option<&str>,
) -> Vec<SearchHit> {
    let q = query.to_ascii_lowercase();
    let mut hits = Vec::new();
    for row in &index.catalog {
        if let Some(filter) = ty {
            if row.ty != filter {
                continue;
            }
        }
        let text = index
            .texts
            .get(&row.id)
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let blob = format!("{} {} {} {}", row.id, row.title, row.path, text).to_ascii_lowercase();
        if !blob.contains(&q) {
            continue;
        }
        let snippet = snippet_of(text, &q);
        let title_score = row.title.to_ascii_lowercase().matches(&q).count() * 10;
        let id_score = row.id.to_ascii_lowercase().matches(&q).count() * 8;
        let text_score = text.to_ascii_lowercase().matches(&q).count();
        hits.push(SearchHit {
            id: row.id.clone(),
            ty: row.ty.clone(),
            path: row.path.clone(),
            title: row.title.clone(),
            snippet,
            score: title_score + id_score + text_score,
        });
    }
    hits.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| a.id.cmp(&b.id)));
    hits.truncate(limit);
    hits
}

fn snippet_of(text: &str, q: &str) -> String {
    let lower = text.to_ascii_lowercase();
    if let Some(idx) = lower.find(q) {
        let start = idx.saturating_sub(40);
        let end = (idx + q.len() + 40).min(text.len());
        let mut s = text[start..end].replace('\n', " ");
        if start > 0 {
            s = format!("…{s}");
        }
        if end < text.len() {
            s.push('…');
        }
        s
    } else {
        text.chars().take(80).collect::<String>().replace('\n', " ")
    }
}

pub fn format_search_hits(hits: &[SearchHit]) -> String {
    if hits.is_empty() {
        return "No matches.".to_string();
    }
    let mut out = String::new();
    for h in hits {
        out.push_str(&format!("{}  {}  {}\n", h.id, h.ty, h.path));
        if !h.snippet.is_empty() {
            out.push_str(&format!("  {}\n", h.snippet));
        }
    }
    out.trim_end().to_string()
}

pub fn links_for(index: &ProjectIndex, id: &str) -> serde_json::Value {
    let outbound: Vec<_> = index
        .edges
        .iter()
        .filter(|e| e.from == id)
        .map(|e| {
            serde_json::json!({
                "to": e.to,
                "kind": e.kind,
                "resolved": e.resolved,
            })
        })
        .collect();
    let backlinks: Vec<_> = index
        .edges
        .iter()
        .filter(|e| e.to == id)
        .map(|e| {
            serde_json::json!({
                "from": e.from,
                "kind": e.kind,
                "resolved": e.resolved,
            })
        })
        .collect();
    let broken: Vec<_> = index
        .edges
        .iter()
        .filter(|e| e.from == id && !e.resolved)
        .map(|e| e.to.clone())
        .collect();
    serde_json::json!({
        "id": id,
        "outbound": outbound,
        "backlinks": backlinks,
        "broken": broken,
    })
}

pub fn format_links_view(view: &serde_json::Value) -> String {
    let id = view.get("id").and_then(|v| v.as_str()).unwrap_or("");
    let mut out = format!("Links for {id}\n");
    out.push_str("outbound:\n");
    if let Some(arr) = view.get("outbound").and_then(|v| v.as_array()) {
        if arr.is_empty() {
            out.push_str("  (none)\n");
        }
        for e in arr {
            out.push_str(&format!(
                "  → {} ({})\n",
                e.get("to").and_then(|v| v.as_str()).unwrap_or(""),
                e.get("kind").and_then(|v| v.as_str()).unwrap_or("")
            ));
        }
    }
    out.push_str("backlinks:\n");
    if let Some(arr) = view.get("backlinks").and_then(|v| v.as_array()) {
        if arr.is_empty() {
            out.push_str("  (none)\n");
        }
        for e in arr {
            out.push_str(&format!(
                "  ← {}\n",
                e.get("from").and_then(|v| v.as_str()).unwrap_or("")
            ));
        }
    }
    out.trim_end().to_string()
}
