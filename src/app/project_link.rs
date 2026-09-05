use std::fs;
use std::path::{Path, PathBuf};

use regex::Regex;
use serde_json::{json, Value};

use crate::domain::project_id::extract_project_id;
use crate::domain::upgrade::extract_harness_block;
use crate::error::{Error, Result};
use crate::infra::entities::atomic_write;
use crate::infra::registry::read_registry;

const VALID_ROLES: &[&str] = &["frontend", "backend", "mobile", "service", "shared", "other"];

pub fn set_role(project_root: &Path, role: &str, stack: Option<&str>) -> Result<Value> {
    if !VALID_ROLES.contains(&role) {
        return Err(Error::new(format!("invalid project role {role}; expected one of {}", VALID_ROLES.join(", "))));
    }
    let stacks = parse_stack(stack)?;
    let agents = project_root.join("AGENTS.md");
    let text = fs::read_to_string(&agents)?;
    let updated = replace_markers(&text, Some(role), Some(&stacks), None, false)?;
    atomic_write(&agents, &updated)?;
    Ok(json!({"role":role,"stack":stacks,"path":agents}))
}

pub fn role(project_root: &Path) -> Result<Value> {
    let text = fs::read_to_string(project_root.join("AGENTS.md"))?;
    Ok(json!({"role": marker_value(&text, "harness-project-role"), "stack": marker_value(&text, "harness-project-stack").map(|v| v.split(',').map(str::to_string).collect::<Vec<_>>())}))
}

pub fn add_peer(project_root: &Path, id_or_path: &str, role: Option<&str>) -> Result<Value> {
    let (peer_id, peer_path) = resolve_project(id_or_path)?;
    let local_id = extract_local_id(project_root)?;
    if peer_id == local_id {
        return Err(Error::new("a project cannot peer with itself"));
    }
    let marker = format!("id={};role={}", peer_id, role.unwrap_or("other"));
    let agents = project_root.join("AGENTS.md");
    let text = fs::read_to_string(&agents)?;
    let updated = replace_markers(&text, None, None, Some(&marker), false)?;
    atomic_write(&agents, &updated)?;
    let reverse = if let Some(ref path) = peer_path {
        if let Ok(peer_agents) = fs::read_to_string(path.join("AGENTS.md")) {
            let reverse_marker = format!("id={};role={}", local_id, role.unwrap_or("other"));
            if let Ok(updated_peer) = replace_markers(&peer_agents, None, None, Some(&reverse_marker), false) {
                let _ = atomic_write(&path.join("AGENTS.md"), &updated_peer);
                true
            } else { false }
        } else { false }
    } else { false };
    Ok(json!({"id":peer_id,"role":role.unwrap_or("other"),"path":peer_path,"reverse_written":reverse}))
}

pub fn remove_peer(project_root: &Path, peer_id: &str) -> Result<bool> {
    let agents = project_root.join("AGENTS.md");
    let text = fs::read_to_string(&agents)?;
    let updated = remove_peer_marker(&text, peer_id);
    if updated == text { return Ok(false); }
    atomic_write(&agents, &updated)?;
    Ok(true)
}

pub fn peers(project_root: &Path) -> Result<Vec<Value>> {
    let text = fs::read_to_string(project_root.join("AGENTS.md"))?;
    let mut out = Vec::new();
    for marker in peer_markers(&text) {
        let mut id = String::new();
        let mut role = "other".to_string();
        for part in marker.split(';') {
            if let Some(value) = part.strip_prefix("id=") { id = value.to_string(); }
            if let Some(value) = part.strip_prefix("role=") { role = value.to_string(); }
        }
        let project = read_registry().projects.into_iter().find(|p| p.id == id);
        out.push(json!({"id":id,"role":role,"name":project.as_ref().map(|p| p.name.clone()),"path":project.as_ref().map(|p| p.path.clone()),"resolved":project.as_ref().is_some_and(|p| Path::new(&p.path).is_dir())}));
    }
    Ok(out)
}

pub fn resolve_peer(project_root: &Path, peer: Option<&str>, role: Option<&str>) -> Result<PathBuf> {
    let configured = peers(project_root)?;
    let selected = if let Some(peer) = peer {
        configured.into_iter().find(|p| p["id"].as_str() == Some(peer) || p["role"].as_str() == Some(peer))
    } else if let Some(role) = role {
        let matches: Vec<_> = configured.into_iter().filter(|p| p["role"].as_str() == Some(role)).collect();
        if matches.len() > 1 { return Err(Error::new(format!("peer role {role} is ambiguous; choose --peer"))); }
        matches.into_iter().next()
    } else {
        return Err(Error::new("peer selector requires --peer or --role"));
    };
    let selected = selected.ok_or_else(|| Error::new("configured peer not found"))?;
    let path = selected["path"].as_str().ok_or_else(|| Error::new("peer is not registered on this machine"))?;
    let path = PathBuf::from(path);
    if !path.is_dir() { return Err(Error::new(format!("peer path is missing: {}", path.display()))); }
    Ok(path)
}

pub fn ensure_peer_write_allowed(target: &Path) -> Result<()> {
    let Some(raw) = std::env::var_os("HARNESS_PEER_WRITE_ROOTS") else { return Ok(()) };
    let separator = if cfg!(windows) { ';' } else { ':' };
    let canonical_target = target.canonicalize()?;
    let mut roots = Vec::new();
    for raw_root in raw.to_string_lossy().split(separator).map(str::trim).filter(|v| !v.is_empty()) {
        let root = PathBuf::from(raw_root);
        if !root.is_absolute() || !root.is_dir() {
            return Err(Error::new("HARNESS_PEER_WRITE_ROOTS must contain existing absolute directories"));
        }
        roots.push(root.canonicalize()?);
    }
    if roots.iter().any(|root| canonical_target.starts_with(root)) { Ok(()) }
    else { Err(Error::new(format!("peer report target is outside HARNESS_PEER_WRITE_ROOTS: {}", target.display()))) }
}

fn resolve_project(id_or_path: &str) -> Result<(String, Option<PathBuf>)> {
    let input = Path::new(id_or_path);
    if input.is_dir() {
        let path = input.canonicalize()?;
        let id = extract_local_id(&path)?;
        return Ok((id, Some(path)));
    }
    let registry = read_registry();
    let project = registry.projects.into_iter().find(|p| p.id == id_or_path).ok_or_else(|| Error::new(format!("project {id_or_path} is not registered")))?;
    Ok((project.id, Some(PathBuf::from(project.path))))
}

fn extract_local_id(project_root: &Path) -> Result<String> {
    extract_project_id(&fs::read_to_string(project_root.join("AGENTS.md"))?).ok_or_else(|| Error::new("project has no durable harness id"))
}

fn parse_stack(stack: Option<&str>) -> Result<Vec<String>> {
    let mut out = Vec::new();
    for raw in stack.unwrap_or("").split(',').map(str::trim).filter(|s| !s.is_empty()) {
        if raw.len() > 32 || !raw.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-') {
            return Err(Error::new(format!("invalid stack tag {raw}")));
        }
        if out.iter().any(|v| v == raw) { return Err(Error::new(format!("duplicate stack tag {raw}"))); }
        if out.len() == 4 { return Err(Error::new("at most four stack tags are allowed")); }
        out.push(raw.to_string());
    }
    Ok(out)
}

fn marker_value(text: &str, key: &str) -> Option<String> {
    let re = Regex::new(&format!(r"<!--\s*{}:\s*([^>]+?)\s*-->", regex::escape(key))).ok()?;
    re.captures(text).and_then(|c| c.get(1).map(|m| m.as_str().trim().to_string()))
}

fn peer_markers(text: &str) -> Vec<String> {
    let re = Regex::new(r"<!--\s*harness-peer:\s*([^>]+?)\s*-->").unwrap();
    re.captures_iter(text).filter_map(|c| c.get(1).map(|m| m.as_str().trim().to_string())).collect()
}

fn remove_peer_marker(text: &str, id: &str) -> String {
    text.lines().filter(|line| !(line.contains("harness-peer:") && line.contains(&format!("id={id};")))).collect::<Vec<_>>().join("\n") + if text.ends_with('\n') { "\n" } else { "" }
}

fn replace_markers(text: &str, role: Option<&str>, stack: Option<&Vec<String>>, peer: Option<&str>, peer_replace: bool) -> Result<String> {
    let block = extract_harness_block(text).ok_or_else(|| Error::new("AGENTS.md has no harness-managed block"))?;
    let mut lines: Vec<String> = block.block.lines().map(str::to_string).collect();
    if let Some(role) = role {
        lines.retain(|line| !line.contains("harness-project-role:"));
        let idx = lines.iter().position(|line| line.contains("harness-project-id:")).map(|i| i + 1).unwrap_or(1);
        lines.insert(idx, format!("<!-- harness-project-role: {role} -->"));
    }
    if let Some(stack) = stack {
        lines.retain(|line| !line.contains("harness-project-stack:"));
        if !stack.is_empty() {
            let idx = lines.iter().position(|line| line.contains("harness-project-role:")).map(|i| i + 1).or_else(|| lines.iter().position(|line| line.contains("harness-project-id:")).map(|i| i + 1)).unwrap_or(1);
            lines.insert(idx, format!("<!-- harness-project-stack: {} -->", stack.join(",")));
        }
    }
    if let Some(peer) = peer {
        if peer_replace || !lines.iter().any(|line| line.contains("harness-peer:") && line.contains(peer.split(';').next().unwrap_or(peer))) {
            let idx = lines.iter().position(|line| line.contains("harness-project-stack:")).map(|i| i + 1).or_else(|| lines.iter().position(|line| line.contains("harness-project-role:")).map(|i| i + 1)).or_else(|| lines.iter().position(|line| line.contains("harness-project-id:")).map(|i| i + 1)).unwrap_or(1);
            lines.insert(idx, format!("<!-- harness-peer: {peer} -->"));
        }
    }
    let block = lines.join("\n");
    Ok(format!("{}{}{}", block.before_marker(text), block, block.after_marker(text)))
}

trait MarkerParts {
    fn before_marker(&self, text: &str) -> String;
    fn after_marker(&self, text: &str) -> String;
}

impl MarkerParts for String {
    fn before_marker(&self, text: &str) -> String { extract_harness_block(text).map(|b| b.before).unwrap_or_default() }
    fn after_marker(&self, text: &str) -> String { extract_harness_block(text).map(|b| b.after).unwrap_or_default() }
}
