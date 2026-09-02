use crate::error::{Error, Result};

pub const ENTITY_TYPES: &[&str] = &["story", "decision", "intake", "backlog", "report"];

pub fn entity_dir(ty: &str) -> Result<&'static str> {
    match ty {
        "story" => Ok("docs/stories"),
        "decision" => Ok("docs/decisions"),
        "intake" => Ok("docs/intakes"),
        "backlog" => Ok("docs/backlog"),
        "report" => Ok("docs/reports"),
        _ => Err(Error::new(format!("Unknown entity type {ty}"))),
    }
}

pub fn sanitize_entity_id(id: &str) -> Result<String> {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return Err(Error::new("Entity id must not be empty"));
    }
    if trimmed.contains("..") || trimmed.contains('/') || trimmed.contains('\\') {
        return Err(Error::new(format!(
            "Invalid entity id (path separators not allowed): {id}"
        )));
    }
    let mut chars = trimmed.chars();
    let first = chars.next().unwrap();
    if !first.is_ascii_alphanumeric() {
        return Err(Error::new(format!(
            "Invalid entity id \"{id}\". Use letters, digits, ., _, - (start with alphanumeric)."
        )));
    }
    if !chars.all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-') {
        return Err(Error::new(format!(
            "Invalid entity id \"{id}\". Use letters, digits, ., _, - (start with alphanumeric)."
        )));
    }
    Ok(trimmed.to_string())
}

pub fn entity_relative_path(ty: &str, id: &str, explicit: Option<&str>) -> Result<String> {
    if let Some(path) = explicit.map(str::trim).filter(|s| !s.is_empty()) {
        let rel = path.replace('\\', "/").trim_start_matches("./").to_string();
        if rel.contains("..") {
            return Err(Error::new(format!("Invalid entity path: {path}")));
        }
        return Ok(rel);
    }
    let safe = sanitize_entity_id(id)?;
    Ok(format!("{}/{safe}.md", entity_dir(ty)?))
}

pub fn parse_links_csv(raw: Option<&str>) -> Option<Vec<String>> {
    raw.map(|s| {
        s.split(',')
            .map(|p| p.trim().to_string())
            .filter(|p| !p.is_empty())
            .collect()
    })
}
