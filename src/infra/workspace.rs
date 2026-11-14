use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use regex::Regex;
use serde::Serialize;

use crate::domain::paths::workspaces_file_path;
use crate::domain::project_id::extract_project_id;
use crate::domain::upgrade::extract_harness_block;
use crate::domain::workspace::{
    clean_path, compute_relative_path, empty_workspace_store, is_excluded_dir_name,
    parse_workspace_store_strict, path_is_within, workspace_paths_equal, WorkspaceStore,
    DEFAULT_DISCOVERY_DEPTH, MAX_DISCOVERY_DEPTH, MAX_DISCOVERY_DIRS,
};
use crate::error::{Error, Result};
use crate::infra::entities::{atomic_write, ensure_directory_no_symlink};
use crate::infra::registry::{detect_project_name, get_harness_home};

pub fn get_workspaces_path() -> PathBuf {
    workspaces_file_path(&get_harness_home())
}

pub fn canonicalize_clean(path: &Path) -> Result<PathBuf> {
    let canonical = fs::canonicalize(path)?;
    Ok(clean_path(&canonical))
}

fn validate_home_and_file_for_read(home: &Path, file: &Path) -> Result<bool> {
    if !home.exists() {
        return Ok(false);
    }
    let home_meta = fs::symlink_metadata(home)?;
    if home_meta.file_type().is_symlink() || !home_meta.is_dir() {
        return Err(Error::with_code(
            "HARNESS_E_STATE",
            format!(
                "Refusing symlinked or non-directory HARNESS_HOME: {}",
                home.display()
            ),
        ));
    }
    ensure_directory_no_symlink(home)?;
    let metadata = match fs::symlink_metadata(file) {
        Ok(m) => m,
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(err) => return Err(err.into()),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(Error::with_code(
            "HARNESS_E_STATE",
            format!(
                "Refusing symlinked or non-file workspace store: {}",
                file.display()
            ),
        ));
    }
    let canonical_home = canonicalize_clean(home)?;
    let canonical_file = canonicalize_clean(file)?;
    if !path_is_within(&canonical_home, &canonical_file) {
        return Err(Error::with_code(
            "HARNESS_E_STATE",
            format!(
                "Workspace store path escapes HARNESS_HOME: {}",
                file.display()
            ),
        ));
    }
    Ok(true)
}

pub fn read_workspace_store() -> Result<WorkspaceStore> {
    let home = get_harness_home();
    let file = workspaces_file_path(&home);
    if !validate_home_and_file_for_read(&home, &file)? {
        return Ok(empty_workspace_store());
    }
    let raw = fs::read_to_string(&file)?;
    if raw.trim().is_empty() {
        return Err(Error::with_code(
            "HARNESS_E_STATE",
            format!(
                "Workspace store {} is empty. Run `harness workspace doctor --repair` to recover it.",
                file.display()
            ),
        ));
    }
    parse_workspace_store_strict(&raw)
}

pub fn write_workspace_store(store: &WorkspaceStore) -> Result<PathBuf> {
    let home = get_harness_home();
    ensure_directory_no_symlink(&home)?;
    let file = workspaces_file_path(&home);
    let payload = format!("{}\n", serde_json::to_string_pretty(store)?);
    atomic_write(&file, &payload)?;
    Ok(file)
}

pub fn backup_workspace_store() -> Result<Option<PathBuf>> {
    let home = get_harness_home();
    let file = workspaces_file_path(&home);
    if fs::symlink_metadata(&file).is_err() {
        return Ok(None);
    }
    ensure_directory_no_symlink(&home)?;
    let metadata = fs::symlink_metadata(&file)?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(Error::with_code(
            "HARNESS_E_STATE",
            format!(
                "Refusing to back up symlinked workspace store: {}",
                file.display()
            ),
        ));
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let backup = home.join(format!("workspaces.json.bak.{stamp}"));
    fs::copy(&file, &backup)?;
    Ok(Some(backup))
}

#[derive(Clone, Debug, Default)]
pub struct HarnessProbe {
    pub harnessed: bool,
    pub project_id: Option<String>,
    pub role: Option<String>,
    pub stack: Vec<String>,
    pub agents_exists: bool,
}

pub fn probe_harness_project(dir: &Path) -> HarnessProbe {
    let agents = dir.join("AGENTS.md");
    let mut probe = HarnessProbe::default();
    if let Ok(meta) = fs::symlink_metadata(&agents) {
        if !meta.file_type().is_symlink() && meta.is_file() {
            probe.agents_exists = true;
            if let Ok(text) = fs::read_to_string(&agents) {
                let has_block = extract_harness_block(&text).is_some();
                probe.project_id = extract_project_id(&text);
                probe.role = extract_marker(&text, "harness-project-role");
                probe.stack = extract_marker(&text, "harness-project-stack")
                    .map(|v| {
                        v.split(',')
                            .map(str::trim)
                            .filter(|s| !s.is_empty())
                            .map(str::to_string)
                            .collect()
                    })
                    .unwrap_or_default();
                if has_block || probe.project_id.is_some() {
                    probe.harnessed = true;
                }
            }
        }
    }
    if !probe.harnessed && dir.join("docs/stories").is_dir() && dir.join("docs/decisions").is_dir()
    {
        probe.harnessed = true;
    }
    probe
}

fn extract_marker(text: &str, key: &str) -> Option<String> {
    let block = extract_harness_block(text)?;
    let re = Regex::new(&format!(r"<!--\s*{}:\s*([^>]+?)\s*-->", regex::escape(key))).ok()?;
    re.captures(&block.block)
        .and_then(|c| c.get(1).map(|m| m.as_str().trim().to_string()))
        .filter(|s| !s.is_empty())
}

#[derive(Clone, Debug, Default)]
pub struct GitProbe {
    pub is_git_repo: bool,
    pub is_worktree: bool,
    pub common_dir: Option<String>,
    pub toplevel: Option<String>,
}

pub fn probe_git_info(dir: &Path) -> GitProbe {
    if !dir.join(".git").exists() {
        return GitProbe::default();
    }
    let Some(toplevel_raw) = git_rev_parse(dir, "--show-toplevel") else {
        return GitProbe::default();
    };
    let toplevel_clean = canonicalize_clean(Path::new(&toplevel_raw))
        .unwrap_or_else(|_| clean_path(Path::new(&toplevel_raw)));
    let dir_clean = canonicalize_clean(dir).unwrap_or_else(|_| clean_path(dir));
    if !workspace_paths_equal(&toplevel_clean, &dir_clean) {
        return GitProbe::default();
    }
    let common_raw = git_rev_parse(dir, "--git-common-dir");
    let git_dir_raw = git_rev_parse(dir, "--git-dir");
    let resolve_git_path = |raw: String| -> String {
        let p = PathBuf::from(&raw);
        let joined = if p.is_absolute() { p } else { dir.join(p) };
        canonicalize_clean(&joined)
            .unwrap_or_else(|_| clean_path(&joined))
            .to_string_lossy()
            .into_owned()
    };
    let common_dir = common_raw.map(resolve_git_path);
    let git_dir = git_dir_raw.map(resolve_git_path);
    let is_worktree = match (&git_dir, &common_dir) {
        (Some(gd), Some(cd)) => !workspace_paths_equal(Path::new(gd), Path::new(cd)),
        _ => dir.join(".git").is_file(),
    };
    GitProbe {
        is_git_repo: true,
        is_worktree,
        common_dir,
        toplevel: Some(toplevel_clean.to_string_lossy().into_owned()),
    }
}

fn git_rev_parse(dir: &Path, flag: &str) -> Option<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(["rev-parse", flag])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let val = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if val.is_empty() {
        None
    } else {
        Some(val)
    }
}

pub fn git_changed_files(
    project_root: &Path,
    since: Option<&str>,
    include_uncommitted: bool,
) -> Result<Vec<String>> {
    if !project_root.join(".git").exists() {
        return Ok(Vec::new());
    }
    let mut files = BTreeSet::new();
    if let Some(since_ref) = since.map(str::trim).filter(|s| !s.is_empty()) {
        let range = format!("{since_ref}..HEAD");
        let out = Command::new("git")
            .arg("-C")
            .arg(project_root)
            .args(["diff", "--name-only", &range])
            .output()?;
        if !out.status.success() {
            return Err(Error::new(format!(
                "git diff --name-only {range} failed in {}: {}",
                project_root.display(),
                String::from_utf8_lossy(&out.stderr).trim()
            )));
        }
        for line in String::from_utf8_lossy(&out.stdout).lines() {
            let trimmed = line.trim();
            if !trimmed.is_empty() {
                files.insert(trimmed.replace('\\', "/"));
            }
        }
    } else if !include_uncommitted {
        // Inspect HEAD~1..HEAD when available; empty if initial/no commits.
        if let Ok(out) = Command::new("git")
            .arg("-C")
            .arg(project_root)
            .args(["diff", "--name-only", "HEAD~1..HEAD"])
            .output()
        {
            if out.status.success() {
                for line in String::from_utf8_lossy(&out.stdout).lines() {
                    let trimmed = line.trim();
                    if !trimmed.is_empty() {
                        files.insert(trimmed.replace('\\', "/"));
                    }
                }
            }
        }
    }
    if include_uncommitted {
        if let Ok(out) = Command::new("git")
            .arg("-C")
            .arg(project_root)
            .args(["status", "--porcelain", "-uall"])
            .output()
        {
            if out.status.success() {
                for line in String::from_utf8_lossy(&out.stdout).lines() {
                    if line.len() > 3 {
                        let path_part = line[3..].trim();
                        let actual = path_part
                            .rsplit_once(" -> ")
                            .map(|(_, dst)| dst)
                            .unwrap_or(path_part)
                            .trim_matches('"');
                        if !actual.is_empty() {
                            files.insert(actual.replace('\\', "/"));
                        }
                    }
                }
            }
        }
    }
    Ok(files.into_iter().collect())
}

#[derive(Clone, Debug, Serialize)]
pub struct DiscoveredCandidate {
    pub name: String,
    pub path: String,
    pub relative_path: String,
    pub kind: String,
    pub harnessed: bool,
    pub is_git_repo: bool,
    pub is_worktree: bool,
    pub worktree_duplicate: bool,
    pub duplicate_of: Option<String>,
    pub nested_under: Option<String>,
    pub project_id: Option<String>,
    pub duplicate_id_with: Option<String>,
    pub role: Option<String>,
    pub stack: Vec<String>,
    pub git_common_dir: Option<String>,
    pub selected_by_default: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct DiscoveryReport {
    pub root_path: String,
    pub depth: usize,
    pub root_is_git: bool,
    pub root_is_harnessed: bool,
    pub truncated: bool,
    pub candidates: Vec<DiscoveredCandidate>,
    pub warnings: Vec<String>,
}

struct RawCandidate {
    name: String,
    path: PathBuf,
    relative_path: String,
    harness: HarnessProbe,
    git: GitProbe,
    nested_under: Option<String>,
}

pub fn discover_workspace_candidates(root: &Path, depth: Option<usize>) -> Result<DiscoveryReport> {
    let max_depth = depth.unwrap_or(DEFAULT_DISCOVERY_DEPTH);
    if max_depth == 0 || max_depth > MAX_DISCOVERY_DEPTH {
        return Err(Error::new(format!(
            "Workspace discovery --depth must be between 1 and {MAX_DISCOVERY_DEPTH}"
        )));
    }
    if !root.is_dir() {
        return Err(Error::new(format!(
            "Workspace path does not exist or is not a directory: {}",
            root.display()
        )));
    }
    let canonical_root = canonicalize_clean(root)?;
    let root_git = probe_git_info(&canonical_root);
    let root_harness = probe_harness_project(&canonical_root);

    let mut warnings = Vec::new();
    let mut visited = BTreeSet::new();
    visited.insert(canonical_key(&canonical_root));

    let mut raw_candidates: Vec<RawCandidate> = Vec::new();
    let mut queue: VecDeque<(PathBuf, usize, Option<String>)> = VecDeque::new();
    queue.push_back((canonical_root.clone(), 0, None));
    let mut inspected_dirs = 0usize;
    let mut truncated = false;

    while let Some((dir, cur_depth, ancestor_project)) = queue.pop_front() {
        if cur_depth >= max_depth {
            continue;
        }
        let entries = match fs::read_dir(&dir) {
            Ok(rd) => rd,
            Err(err) => {
                warnings.push(format!("Unreadable directory {}: {err}", dir.display()));
                continue;
            }
        };
        let mut child_dirs: Vec<PathBuf> = Vec::new();
        for entry in entries.flatten() {
            let child_path = entry.path();
            let file_name = entry.file_name().to_string_lossy().into_owned();
            if is_excluded_dir_name(&file_name) {
                continue;
            }
            let Ok(meta) = fs::symlink_metadata(&child_path) else {
                continue;
            };
            let is_symlink = meta.file_type().is_symlink();
            if is_symlink {
                match canonicalize_clean(&child_path) {
                    Ok(target) if target.is_dir() => {
                        if !path_is_within(&canonical_root, &target) {
                            warnings.push(format!(
                                "Skipped symlink/junction escaping workspace root: {}",
                                child_path.display()
                            ));
                            continue;
                        }
                        child_dirs.push(target);
                    }
                    Ok(_) => continue,
                    Err(err) => {
                        warnings.push(format!(
                            "Skipped broken symlink/junction {}: {err}",
                            child_path.display()
                        ));
                        continue;
                    }
                }
            } else if meta.is_dir() {
                child_dirs.push(child_path);
            }
        }
        child_dirs.sort();

        for child in child_dirs {
            if inspected_dirs >= MAX_DISCOVERY_DIRS {
                truncated = true;
                warnings.push(format!(
                    "Discovery capped at {MAX_DISCOVERY_DIRS} directories; pass --project or narrower --depth to target specific subdirectories."
                ));
                break;
            }
            let canonical_child = match canonicalize_clean(&child) {
                Ok(c) => c,
                Err(err) => {
                    warnings.push(format!(
                        "Skipped unreadable path {}: {err}",
                        child.display()
                    ));
                    continue;
                }
            };
            if !path_is_within(&canonical_root, &canonical_child) {
                warnings.push(format!(
                    "Skipped path escaping workspace root: {}",
                    child.display()
                ));
                continue;
            }
            if !visited.insert(canonical_key(&canonical_child)) {
                continue;
            }
            inspected_dirs += 1;

            let harness = probe_harness_project(&canonical_child);
            let git = probe_git_info(&canonical_child);
            let is_candidate = harness.harnessed || git.is_git_repo;
            let rel = compute_relative_path(&canonical_root, &canonical_child)?;
            let next_ancestor = if is_candidate {
                let name = detect_project_name(&canonical_child);
                raw_candidates.push(RawCandidate {
                    name,
                    path: canonical_child.clone(),
                    relative_path: rel.clone(),
                    harness,
                    git,
                    nested_under: ancestor_project.clone(),
                });
                Some(rel)
            } else {
                ancestor_project.clone()
            };
            if cur_depth + 1 < max_depth {
                queue.push_back((canonical_child, cur_depth + 1, next_ancestor));
            }
        }
        if truncated {
            break;
        }
    }

    // Group by git_common_dir to detect duplicate worktrees of the same repository.
    let mut primary_by_common_dir: BTreeMap<String, String> = BTreeMap::new();
    for c in &raw_candidates {
        if let Some(common) = &c.git.common_dir {
            let key = common_dir_key(common);
            let is_primary = !c.git.is_worktree;
            match primary_by_common_dir.get(&key) {
                None => {
                    primary_by_common_dir.insert(key, c.path.to_string_lossy().into_owned());
                }
                Some(_) if is_primary => {
                    primary_by_common_dir.insert(key, c.path.to_string_lossy().into_owned());
                }
                Some(_) => {}
            }
        }
    }

    // Track project_id duplicates across non-worktree candidates.
    let mut first_path_by_project_id: BTreeMap<String, String> = BTreeMap::new();
    let mut candidates = Vec::with_capacity(raw_candidates.len());
    for c in raw_candidates {
        let path_str = c.path.to_string_lossy().into_owned();
        let (worktree_duplicate, duplicate_of) = match &c.git.common_dir {
            Some(common) => {
                let primary = primary_by_common_dir.get(&common_dir_key(common)).cloned();
                match primary {
                    Some(p) if !workspace_paths_equal(Path::new(&p), &c.path) => (true, Some(p)),
                    _ => (false, None),
                }
            }
            None => (false, None),
        };
        let duplicate_id_with = if !worktree_duplicate {
            c.harness.project_id.as_ref().and_then(|pid| {
                if let Some(existing_path) = first_path_by_project_id.get(pid) {
                    Some(existing_path.clone())
                } else {
                    first_path_by_project_id.insert(pid.clone(), path_str.clone());
                    None
                }
            })
        } else {
            None
        };
        let kind = if worktree_duplicate {
            "worktree_duplicate"
        } else if c.nested_under.is_some() {
            "nested_repo"
        } else if c.harness.harnessed && c.git.is_git_repo {
            "harnessed_git"
        } else if c.harness.harnessed {
            "harnessed_non_git"
        } else {
            "unharnessed_git"
        };
        let selected_by_default =
            !worktree_duplicate && c.nested_under.is_none() && duplicate_id_with.is_none();
        if duplicate_id_with.is_some() {
            warnings.push(format!(
                "Duplicate harness-project-id '{}' at {} (already seen at {}).",
                c.harness.project_id.as_deref().unwrap_or(""),
                path_str,
                duplicate_id_with.as_deref().unwrap_or("")
            ));
        }
        candidates.push(DiscoveredCandidate {
            name: c.name,
            path: path_str,
            relative_path: c.relative_path,
            kind: kind.to_string(),
            harnessed: c.harness.harnessed,
            is_git_repo: c.git.is_git_repo,
            is_worktree: c.git.is_worktree,
            worktree_duplicate,
            duplicate_of,
            nested_under: c.nested_under,
            project_id: c.harness.project_id,
            duplicate_id_with,
            role: c.harness.role,
            stack: c.harness.stack,
            git_common_dir: c.git.common_dir,
            selected_by_default,
        });
    }

    Ok(DiscoveryReport {
        root_path: canonical_root.to_string_lossy().into_owned(),
        depth: max_depth,
        root_is_git: root_git.is_git_repo,
        root_is_harnessed: root_harness.harnessed,
        truncated,
        candidates,
        warnings,
    })
}

fn canonical_key(path: &Path) -> String {
    let cleaned = clean_path(path).to_string_lossy().into_owned();
    #[cfg(windows)]
    {
        cleaned.to_ascii_lowercase()
    }
    #[cfg(not(windows))]
    {
        cleaned
    }
}

fn common_dir_key(common: &str) -> String {
    canonical_key(Path::new(common))
}
