use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::domain::entities::{entity_dir, entity_relative_path, ENTITY_TYPES};
use crate::domain::frontmatter::{
    as_string, parse_frontmatter, serialize_entity_file, Frontmatter,
};
use crate::error::{Error, Result};

#[derive(Clone, Debug)]
pub struct EntityFile {
    pub absolute_path: PathBuf,
    pub relative_path: String,
    pub data: Frontmatter,
    pub body: String,
}

pub fn ensure_entity_dirs(project_root: &Path) -> Result<()> {
    for ty in ENTITY_TYPES {
        fs::create_dir_all(project_root.join(entity_dir(ty)?))?;
    }
    Ok(())
}

pub fn read_entity_file(project_root: &Path, relative_path: &str) -> Result<Option<EntityFile>> {
    let absolute_path = project_root.join(relative_path);
    if !absolute_path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&absolute_path)?;
    let (data, body) = parse_frontmatter(&content)?;
    Ok(Some(EntityFile {
        absolute_path,
        relative_path: relative_path.replace('\\', "/"),
        data,
        body,
    }))
}

pub fn read_entity_by_id(project_root: &Path, ty: &str, id: &str) -> Result<Option<EntityFile>> {
    let relative = entity_relative_path(ty, id, None)?;
    read_entity_file(project_root, &relative)
}

pub fn write_entity_file(
    project_root: &Path,
    relative_path: &str,
    data: &Frontmatter,
    body: &str,
) -> Result<EntityFile> {
    let absolute_path = project_root.join(relative_path);
    if let Some(parent) = absolute_path.parent() {
        fs::create_dir_all(parent)?;
    }
    let content = serialize_entity_file(data, body);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = absolute_path.with_extension(format!("md.{nanos}.tmp"));
    fs::write(&tmp, content)?;
    fs::rename(&tmp, &absolute_path)?;
    Ok(EntityFile {
        absolute_path,
        relative_path: relative_path.replace('\\', "/"),
        data: data.clone(),
        body: body.to_string(),
    })
}

pub fn list_entity_files(project_root: &Path, ty: &str) -> Result<Vec<EntityFile>> {
    let dir = project_root.join(entity_dir(ty)?);
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let mut names: Vec<_> = fs::read_dir(&dir)?
        .filter_map(|e| e.ok())
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .filter(|n| n.ends_with(".md") && n.to_ascii_lowercase() != "readme.md")
        .collect();
    names.sort();
    let mut out = Vec::new();
    for name in names {
        let relative_path = format!("{}/{}", entity_dir(ty)?, name);
        let Some(file) = read_entity_file(project_root, &relative_path)? else {
            continue;
        };
        if let Some(ft) = as_string(&file.data, "type") {
            if ft != ty {
                continue;
            }
        } else if as_string(&file.data, "id").is_none() {
            continue;
        }
        out.push(file);
    }
    Ok(out)
}

pub fn next_numeric_entity_id(project_root: &Path, ty: &str, prefix: &str) -> Result<String> {
    let files = list_entity_files(project_root, ty)?;
    let mut max = 0i64;
    let re = regex::Regex::new(&format!("(?i)^{}(\\d+)$", regex::escape(prefix)))
        .map_err(|e| Error::new(e.to_string()))?;
    for f in files {
        let id = as_string(&f.data, "id").unwrap_or_else(|| {
            Path::new(&f.relative_path)
                .file_stem()
                .map(|s| s.to_string_lossy().into_owned())
                .unwrap_or_default()
        });
        if let Some(c) = re.captures(&id) {
            if let Some(n) = c.get(1).and_then(|m| m.as_str().parse::<i64>().ok()) {
                max = max.max(n);
            }
        }
    }
    Ok(format!("{prefix}{:03}", max + 1))
}

pub fn atomic_write(path: &Path, content: &str) -> Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let tmp = path.with_extension(format!("tmp.{nanos}"));
    fs::write(&tmp, content)?;
    fs::rename(&tmp, path)?;
    Ok(())
}
