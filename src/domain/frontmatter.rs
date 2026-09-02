use std::collections::BTreeMap;

use crate::error::{Error, Result};

#[derive(Clone, Debug, PartialEq)]
pub enum FmValue {
    Null,
    Bool(bool),
    Int(i64),
    Float(f64),
    Str(String),
    Arr(Vec<String>),
}

pub type Frontmatter = BTreeMap<String, FmValue>;

pub fn parse_frontmatter(content: &str) -> Result<(Frontmatter, String)> {
    let normalized = content.trim_start_matches('\u{feff}').replace('\r', "");
    if !normalized.starts_with("---") {
        return Ok((BTreeMap::new(), normalized));
    }
    let Some(end) = normalized.find("\n---") else {
        return Ok((BTreeMap::new(), normalized));
    };
    let yaml_block = normalized[4..end].trim_start_matches('\n');
    let mut body = normalized[end + 4..].to_string();
    if body.starts_with('\n') {
        body = body[1..].to_string();
    }
    Ok((parse_simple_yaml(yaml_block)?, body))
}

pub fn serialize_entity_file(data: &Frontmatter, body: &str) -> String {
    let yaml = serialize_simple_yaml(data);
    let trimmed = body.trim_start_matches('\n').trim_end();
    let body_part = if trimmed.is_empty() {
        String::new()
    } else {
        format!("{trimmed}\n")
    };
    if body_part.is_empty() {
        format!("---\n{yaml}---\n")
    } else {
        format!("---\n{yaml}---\n\n{body_part}")
    }
}

fn parse_simple_yaml(block: &str) -> Result<Frontmatter> {
    let mut data = BTreeMap::new();
    let lines: Vec<&str> = block.split('\n').collect();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i];
        if line.trim().is_empty() || line.trim().starts_with('#') {
            i += 1;
            continue;
        }
        let Some((key, rest)) = split_key(line) else {
            return Err(Error::new(format!("Invalid frontmatter line: {line}")));
        };
        if rest.is_empty() || rest == "|" || rest == ">" {
            let mut items = Vec::new();
            let mut j = i + 1;
            while j < lines.len() {
                let t = lines[j];
                let trimmed = t.trim_start();
                if let Some(item) = trimmed.strip_prefix("- ") {
                    items.push(unquote(item.trim()));
                    j += 1;
                } else {
                    break;
                }
            }
            if !items.is_empty() {
                data.insert(key, FmValue::Arr(items));
                i = j;
                continue;
            }
            data.insert(
                key,
                if rest.is_empty() {
                    FmValue::Null
                } else {
                    FmValue::Str(rest.to_string())
                },
            );
            i += 1;
            continue;
        }
        if rest.starts_with('[') && rest.ends_with(']') {
            let inner = rest[1..rest.len() - 1].trim();
            let arr = if inner.is_empty() {
                Vec::new()
            } else {
                inner
                    .split(',')
                    .map(|s| unquote(s.trim()))
                    .collect()
            };
            data.insert(key, FmValue::Arr(arr));
            i += 1;
            continue;
        }
        data.insert(key, parse_scalar(rest.trim()));
        i += 1;
    }
    Ok(data)
}

fn split_key(line: &str) -> Option<(String, String)> {
    let mut chars = line.chars();
    let first = chars.next()?;
    if !(first.is_ascii_alphabetic() || first == '_') {
        return None;
    }
    let mut key = String::new();
    key.push(first);
    let rest_str = chars.as_str();
    let mut consumed = 0;
    for c in rest_str.chars() {
        if c.is_ascii_alphanumeric() || c == '_' {
            key.push(c);
            consumed += c.len_utf8();
        } else {
            break;
        }
    }
    let after_key = &rest_str[consumed..];
    let after = after_key.trim_start();
    let after = after.strip_prefix(':')?;
    Some((key, after.trim_start().to_string()))
}

fn serialize_simple_yaml(data: &Frontmatter) -> String {
    let mut lines = Vec::new();
    for (key, value) in data {
        match value {
            FmValue::Arr(items) if items.is_empty() => lines.push(format!("{key}: []")),
            FmValue::Arr(items) => {
                lines.push(format!("{key}:"));
                for item in items {
                    lines.push(format!("  - {}", format_scalar_str(item)));
                }
            }
            other => lines.push(format!("{key}: {}", format_scalar(other))),
        }
    }
    if lines.is_empty() {
        String::new()
    } else {
        format!("{}\n", lines.join("\n"))
    }
}

fn parse_scalar(raw: &str) -> FmValue {
    match raw {
        "null" | "~" => FmValue::Null,
        "true" => FmValue::Bool(true),
        "false" => FmValue::Bool(false),
        _ if looks_int(raw) => FmValue::Int(raw.parse().unwrap_or(0)),
        _ if looks_float(raw) => FmValue::Float(raw.parse().unwrap_or(0.0)),
        _ => FmValue::Str(unquote(raw)),
    }
}

fn looks_int(raw: &str) -> bool {
    let s = raw.strip_prefix('-').unwrap_or(raw);
    !s.is_empty() && s.chars().all(|c| c.is_ascii_digit())
}

fn looks_float(raw: &str) -> bool {
    let s = raw.strip_prefix('-').unwrap_or(raw);
    let mut parts = s.split('.');
    let a = parts.next().unwrap_or("");
    let b = parts.next();
    parts.next().is_none()
        && !a.is_empty()
        && a.chars().all(|c| c.is_ascii_digit())
        && b.is_some_and(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}

fn unquote(raw: &str) -> String {
    if raw.len() >= 2 && raw.starts_with('"') && raw.ends_with('"') {
        if let Ok(v) = serde_json::from_str::<String>(raw) {
            return v;
        }
        return raw[1..raw.len() - 1].replace("\\\"", "\"").replace("\\\\", "\\");
    }
    if raw.len() >= 2 && raw.starts_with('\'') && raw.ends_with('\'') {
        return raw[1..raw.len() - 1].to_string();
    }
    raw.to_string()
}

fn format_scalar(value: &FmValue) -> String {
    match value {
        FmValue::Null => "null".into(),
        FmValue::Bool(b) => b.to_string(),
        FmValue::Int(n) => n.to_string(),
        FmValue::Float(n) => n.to_string(),
        FmValue::Str(s) => format_scalar_str(s),
        FmValue::Arr(_) => "[]".into(),
    }
}

fn format_scalar_str(value: &str) -> String {
    if value.is_empty()
        || value.chars().any(|c| ":#[]{},&*!|>'\"%@`".contains(c) || c == '\n' || c == '\r')
        || value.starts_with(' ')
        || value.ends_with(' ')
        || looks_int(value)
        || looks_float(value)
        || matches!(value, "true" | "false" | "null")
    {
        serde_json::to_string(value).unwrap_or_else(|_| format!("\"{value}\""))
    } else {
        value.to_string()
    }
}

pub fn as_string(data: &Frontmatter, key: &str) -> Option<String> {
    match data.get(key)? {
        FmValue::Null => None,
        FmValue::Str(s) => Some(s.clone()),
        FmValue::Int(n) => Some(n.to_string()),
        FmValue::Float(n) => Some(n.to_string()),
        FmValue::Bool(b) => Some(b.to_string()),
        FmValue::Arr(_) => None,
    }
}

pub fn as_string_array(data: &Frontmatter, key: &str) -> Option<Vec<String>> {
    match data.get(key)? {
        FmValue::Null => None,
        FmValue::Arr(a) => Some(a.clone()),
        FmValue::Str(s) if !s.trim().is_empty() => Some(
            s.split(',')
                .map(|p| p.trim().to_string())
                .filter(|p| !p.is_empty())
                .collect(),
        ),
        _ => None,
    }
}

pub fn as_bool01(data: &Frontmatter, key: &str) -> Option<i64> {
    match data.get(key)? {
        FmValue::Int(n) => Some(if *n != 0 { 1 } else { 0 }),
        FmValue::Bool(b) => Some(if *b { 1 } else { 0 }),
        FmValue::Str(s) => match s.as_str() {
            "1" | "true" | "yes" => Some(1),
            "0" | "false" | "no" => Some(0),
            _ => None,
        },
        _ => None,
    }
}

pub fn insert_str(data: &mut Frontmatter, key: &str, value: impl Into<String>) {
    data.insert(key.to_string(), FmValue::Str(value.into()));
}

pub fn insert_null(data: &mut Frontmatter, key: &str) {
    data.insert(key.to_string(), FmValue::Null);
}

pub fn insert_int(data: &mut Frontmatter, key: &str, value: i64) {
    data.insert(key.to_string(), FmValue::Int(value));
}

pub fn insert_arr(data: &mut Frontmatter, key: &str, value: Vec<String>) {
    data.insert(key.to_string(), FmValue::Arr(value));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_story_frontmatter() {
        let mut data = Frontmatter::new();
        insert_str(&mut data, "id", "US-100");
        insert_str(&mut data, "type", "story");
        insert_int(&mut data, "unit", 1);
        insert_null(&mut data, "notes");
        let raw = serialize_entity_file(&data, "# Phase B story\n\n");
        let (parsed, body) = parse_frontmatter(&raw).unwrap();
        assert_eq!(as_string(&parsed, "id").as_deref(), Some("US-100"));
        assert_eq!(as_bool01(&parsed, "unit"), Some(1));
        assert!(body.contains("Phase B story"));
    }
}
