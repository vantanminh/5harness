use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::domain::entities::{entity_dir, entity_relative_path, ENTITY_TYPES};
use crate::domain::paths::resolve_project_state_root;
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

/// Cross-process lock for durable project mutations.
///
/// Every mutation must hold this lock from ID allocation through the atomic
/// entity write and index rebuild.  A lock file is intentionally used instead
/// of an in-memory mutex because agents commonly run as separate CLI
/// processes.  We never remove another process's lock: a crashed writer is
/// reported after the bounded wait so an operator can recover it explicitly.
pub struct MutationLock {
    path: PathBuf,
}

impl MutationLock {
    pub fn acquire(project_root: &Path) -> Result<Self> {
        let state = resolve_project_state_root(project_root);
        fs::create_dir_all(&state)?;
        let path = state.join("mutation.lock");
        let timeout_ms = std::env::var("HARNESS_LOCK_TIMEOUT_MS")
            .ok()
            .and_then(|v| v.parse::<u64>().ok())
            .unwrap_or(30_000);
        let deadline = Instant::now() + Duration::from_millis(timeout_ms);
        loop {
            match OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(mut file) => {
                    let _ = writeln!(file, "pid={} acquired_at={}", std::process::id(), chrono::Utc::now().to_rfc3339());
                    return Ok(Self { path });
                }
                Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
                    if Instant::now() >= deadline {
                        return Err(Error::new(format!(
                            "Project mutation lock is busy: {}. Wait for the active harness process or remove the lock after confirming it is stale.",
                            path.display()
                        )));
                    }
                    thread::sleep(Duration::from_millis(10));
                }
                Err(err) => return Err(Error::new(format!("create mutation lock {}: {err}", path.display()))),
            }
        }
    }
}

impl Drop for MutationLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

/// Resolve a user-supplied project-relative path without allowing absolute,
/// parent, or platform-prefix components.  The returned path always uses `/`.
pub fn safe_relative_path(relative_path: &str) -> Result<String> {
    let normalized = relative_path.replace('\\', "/");
    if normalized.trim().is_empty()
        || normalized.starts_with('/')
        || normalized.starts_with('~')
        || normalized.split('/').next().is_some_and(|part| part.contains(':'))
        || Path::new(&normalized).has_root()
    {
        return Err(Error::new(format!("Path must be project-relative: {relative_path}")));
    }
    let mut parts = Vec::new();
    for component in Path::new(&normalized).components() {
        match component {
            Component::Normal(value) => {
                let value = value.to_string_lossy();
                if value.is_empty() {
                    continue;
                }
                parts.push(value.into_owned());
            }
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(Error::new(format!("Path escapes project root: {relative_path}")));
            }
        }
    }
    if parts.is_empty() {
        return Err(Error::new(format!("Path must name a project file: {relative_path}")));
    }
    Ok(parts.join("/"))
}

fn contained_path(project_root: &Path, relative_path: &str, for_write: bool) -> Result<(PathBuf, String)> {
    let relative = safe_relative_path(relative_path)?;
    let root = fs::canonicalize(project_root)
        .map_err(|e| Error::new(format!("project root {} is not accessible: {e}", project_root.display())))?;
    let candidate = root.join(&relative);
    if for_write {
        if let Some(parent) = candidate.parent() {
            fs::create_dir_all(parent)?;
            let canonical_parent = fs::canonicalize(parent)?;
            if !canonical_parent.starts_with(&root) {
                return Err(Error::new(format!("Path escapes project root: {relative_path}")));
            }
        }
    } else if candidate.exists() {
        let canonical = fs::canonicalize(&candidate)?;
        if !canonical.starts_with(&root) {
            return Err(Error::new(format!("Path escapes project root: {relative_path}")));
        }
    }
    Ok((candidate, relative))
}

pub fn ensure_entity_dirs(project_root: &Path) -> Result<()> {
    for ty in ENTITY_TYPES {
        fs::create_dir_all(project_root.join(entity_dir(ty)?))?;
    }
    Ok(())
}

pub fn read_entity_file(project_root: &Path, relative_path: &str) -> Result<Option<EntityFile>> {
    let (absolute_path, relative_path) = contained_path(project_root, relative_path, false)?;
    if !absolute_path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&absolute_path)?;
    let (data, body) = parse_frontmatter(&content)?;
    Ok(Some(EntityFile {
        absolute_path,
        relative_path,
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
    let (absolute_path, relative_path) = contained_path(project_root, relative_path, true)?;
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
        relative_path,
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
