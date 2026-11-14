use std::collections::{BTreeMap, BTreeSet};
use std::env;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::Utc;
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::domain::paths::resolve_harness_home;
use crate::domain::project_id::{extract_project_id, insert_project_id_marker};
use crate::domain::skill::{
    classify_skill_source, find_agent_spec, parse_skill_metadata, resolve_user_home,
    skills_lock_file_path, validate_skill_name, AgentSpec, SkillLockEntry, SkillMeta, SkillSource,
    SkillsLock, BUNDLED_AGENTS_MD, BUNDLED_HARNESS_SKILL_MD, BUNDLED_SKILL_NAME,
    SKILLS_LOCK_SCHEMA_VERSION, SUPPORTED_AGENTS,
};
use crate::domain::upgrade::{extract_harness_block, replace_harness_block};
use crate::error::{Error, Result};
use crate::infra::entities::{atomic_write, ensure_directory_no_symlink};
use crate::infra::package_root::resolve_package_root;

const MAX_SUPPORTING_FILES: usize = 64;
const MAX_SKILL_TOTAL_BYTES: u64 = 2 * 1024 * 1024;
const SUPPORTING_SUBDIRS: &[&str] = &["scripts", "references", "examples", "resources", "assets"];

#[derive(Clone, Debug)]
struct SkillFilePayload {
    relative: String,
    bytes: Vec<u8>,
}

#[derive(Clone, Debug)]
struct LoadedSkill {
    meta: SkillMeta,
    source_label: String,
    sha256: String,
    files: Vec<SkillFilePayload>,
}

#[derive(Clone, Debug)]
struct AgentTarget {
    dir: PathBuf,
    agents: Vec<&'static str>,
}

#[derive(Clone, Debug, Serialize)]
pub struct UpgradeResult {
    pub target_dir: PathBuf,
    pub version: String,
    pub dry_run: bool,
    pub agents_updated: bool,
    pub skill_action: String,
    pub agents_path: PathBuf,
    pub skill_path: PathBuf,
}

#[derive(Clone, Debug, Serialize)]
pub struct SkillInstallTargetReport {
    pub agents: Vec<String>,
    pub path: String,
    pub action: String,
    pub files_written: usize,
}

#[derive(Clone, Debug, Serialize)]
pub struct SkillInstallEntryReport {
    pub name: String,
    pub description: String,
    pub source: String,
    pub sha256: String,
    pub targets: Vec<SkillInstallTargetReport>,
}

#[derive(Clone, Debug, Serialize)]
pub struct SkillAddReport {
    pub scope: String,
    pub dry_run: bool,
    pub discovered_count: usize,
    pub installed: Vec<SkillInstallEntryReport>,
}

#[derive(Clone, Debug, Serialize)]
pub struct SkillListItem {
    pub name: String,
    pub description: String,
    pub scope: String,
    pub agents: Vec<String>,
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct SkillRemoveTargetReport {
    pub agents: Vec<String>,
    pub path: String,
    pub removed: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct SkillRemoveReport {
    pub name: String,
    pub scope: String,
    pub dry_run: bool,
    pub targets: Vec<SkillRemoveTargetReport>,
}

#[derive(Clone, Debug, Serialize)]
pub struct AgentInfoReport {
    pub id: String,
    pub aliases: Vec<String>,
    pub display_name: String,
    pub project_skills_dir: String,
    pub global_skills_dir: String,
    pub detected_project: bool,
    pub detected_global: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct SkillShowReport {
    pub name: String,
    pub description: String,
    pub source: String,
    pub content: String,
}

pub fn load_bundled_agents_template() -> String {
    if let Ok(root) = resolve_package_root() {
        let candidate = root.join("templates").join("AGENTS.md");
        if let Ok(text) = fs::read_to_string(candidate) {
            return text;
        }
    }
    BUNDLED_AGENTS_MD.to_string()
}

pub fn load_bundled_skill_md() -> String {
    if let Ok(root) = resolve_package_root() {
        let candidate = root
            .join("templates")
            .join(".agents")
            .join("skills")
            .join("harness")
            .join("SKILL.md");
        if let Ok(text) = fs::read_to_string(candidate) {
            return text;
        }
    }
    BUNDLED_HARNESS_SKILL_MD.to_string()
}

pub fn run_upgrade(target_dir: &Path, version: &str, dry_run: bool) -> Result<UpgradeResult> {
    let agents_path = target_dir.join("AGENTS.md");
    if !agents_path.exists() {
        return Err(Error::with_code(
            "HARNESS_E_NOT_FOUND",
            format!(
                "AGENTS.md not found in {}. Run `harness init` first.",
                target_dir.display()
            ),
        ));
    }
    refuse_if_symlink(&agents_path, "AGENTS.md")?;

    let existing = fs::read_to_string(&agents_path)?;
    let version_re = regex::Regex::new(r"(?m)^(<!--\s*harness-version:)\s*[^>]+(-->\s*)$").unwrap();
    if !version_re.is_match(&existing) && extract_harness_block(&existing).is_none() {
        return Err(Error::with_code(
            "HARNESS_E_VALIDATION",
            "AGENTS.md has no harness-managed version marker or HARNESS block",
        ));
    }

    let template = load_bundled_agents_template();
    let updated_agents = if let Some(template_block) = extract_harness_block(&template) {
        let versioned_block = version_re
            .replace(&template_block.block, format!("$1 {version} $2"))
            .into_owned();
        let replaced = if extract_harness_block(&existing).is_some() {
            replace_harness_block(&existing, &versioned_block)
        } else {
            version_re
                .replace(&existing, format!("$1 {version} $2"))
                .into_owned()
        };
        if let Some(pid) = extract_project_id(&existing) {
            if extract_project_id(&replaced).is_none() {
                insert_project_id_marker(&replaced, &pid)?
            } else {
                replaced
            }
        } else {
            replaced
        }
    } else {
        version_re
            .replace(&existing, format!("$1 {version} $2"))
            .into_owned()
    };

    let agents_updated = updated_agents != existing;

    let skill_dir = target_dir.join(".agents").join("skills").join("harness");
    let skill_path = skill_dir.join("SKILL.md");
    refuse_if_symlink(&skill_path, "SKILL.md")?;
    let desired_skill = load_bundled_skill_md();
    let skill_action = match fs::read_to_string(&skill_path) {
        Ok(current) if current == desired_skill => "unchanged".to_string(),
        Ok(_) => "updated".to_string(),
        Err(err) if err.kind() == std::io::ErrorKind::NotFound => "created".to_string(),
        Err(err) => return Err(err.into()),
    };

    if !dry_run {
        if agents_updated {
            atomic_write(&agents_path, &updated_agents)?;
        }
        if skill_action != "unchanged" {
            ensure_directory_no_symlink(&skill_dir)?;
            atomic_write(&skill_path, &desired_skill)?;
        }
    }

    Ok(UpgradeResult {
        target_dir: target_dir.to_path_buf(),
        version: version.to_string(),
        dry_run,
        agents_updated,
        skill_action,
        agents_path,
        skill_path,
    })
}

#[derive(Clone, Debug)]
pub struct SkillAddOptions {
    pub source: Option<String>,
    pub skills: Vec<String>,
    pub agents: Vec<String>,
    pub global: bool,
    pub all: bool,
    pub yes: bool,
    pub dry_run: bool,
}

pub fn add_skills(
    opts: &SkillAddOptions,
    project_dir: &Path,
    cwd: &Path,
) -> Result<SkillAddReport> {
    let source = classify_skill_source(opts.source.as_deref(), cwd)?;
    let loaded = load_skills_from_source(&source)?;
    if loaded.is_empty() {
        return Err(Error::with_code(
            "HARNESS_E_NOT_FOUND",
            "No valid skills (SKILL.md) found in the requested source.",
        ));
    }

    let selected = select_skills(&loaded, opts)?;
    let scope = if opts.global { "global" } else { "project" }.to_string();
    let targets = resolve_target_agents(&opts.agents, opts.global, project_dir)?;

    let mut reports = Vec::with_capacity(selected.len());
    let mut lock_updates: Vec<SkillLockEntry> = Vec::new();
    let now = Utc::now().to_rfc3339();

    for skill in &selected {
        let mut target_reports = Vec::with_capacity(targets.len());
        for target in &targets {
            let skill_root = target.dir.join(&skill.meta.name);
            refuse_if_symlink(&skill_root, "skill directory")?;
            let action = classify_skill_install_action(&skill_root, &skill.files)?;

            if !opts.dry_run {
                ensure_directory_no_symlink(&skill_root)?;
                for payload in &skill.files {
                    let dest = skill_root.join(&payload.relative);
                    if let Some(parent) = dest.parent() {
                        ensure_directory_no_symlink(parent)?;
                    }
                    refuse_if_symlink(&dest, "skill file")?;
                    atomic_write_bytes(&dest, &payload.bytes)?;
                }
                lock_updates.push(SkillLockEntry {
                    name: skill.meta.name.clone(),
                    scope: scope.clone(),
                    source: skill.source_label.clone(),
                    agents: target.agents.iter().map(|s| (*s).to_string()).collect(),
                    path: skill_root.to_string_lossy().into_owned(),
                    sha256: skill.sha256.clone(),
                    updated_at: now.clone(),
                });
            }

            target_reports.push(SkillInstallTargetReport {
                agents: target.agents.iter().map(|s| (*s).to_string()).collect(),
                path: skill_root.to_string_lossy().into_owned(),
                action,
                files_written: skill.files.len(),
            });
        }

        reports.push(SkillInstallEntryReport {
            name: skill.meta.name.clone(),
            description: skill.meta.description.clone(),
            source: skill.source_label.clone(),
            sha256: skill.sha256.clone(),
            targets: target_reports,
        });
    }

    if !opts.dry_run && !lock_updates.is_empty() {
        record_skills_lock_updates(&lock_updates)?;
    }

    Ok(SkillAddReport {
        scope,
        dry_run: opts.dry_run,
        discovered_count: loaded.len(),
        installed: reports,
    })
}

pub fn list_skills(
    agents: &[String],
    global: Option<bool>,
    project_dir: &Path,
) -> Result<Vec<SkillListItem>> {
    let lock = load_skills_lock()?;
    let mut lock_by_path: BTreeMap<String, &SkillLockEntry> = BTreeMap::new();
    for entry in &lock.entries {
        lock_by_path.insert(dedup_key(Path::new(&entry.path)), entry);
    }

    let scopes: Vec<bool> = match global {
        Some(flag) => vec![flag],
        None => vec![false, true],
    };

    let explicit_agents = parse_agent_filter(agents)?;
    let user_home = resolve_user_home();
    let mut seen: BTreeMap<String, SkillListItem> = BTreeMap::new();

    for is_global in scopes {
        let scope_label = if is_global { "global" } else { "project" };
        let specs: Vec<&'static AgentSpec> = match &explicit_agents {
            Some(list) => list.clone(),
            None => SUPPORTED_AGENTS.iter().collect(),
        };
        for spec in specs {
            let base = if is_global {
                user_home.join(spec.global_skills_dir)
            } else {
                project_dir.join(spec.project_skills_dir)
            };
            if !base.is_dir() || is_symlink_path(&base) {
                continue;
            }
            let Ok(entries) = fs::read_dir(&base) else {
                continue;
            };
            for entry in entries.flatten() {
                let skill_dir = entry.path();
                if is_symlink_path(&skill_dir) || !skill_dir.is_dir() {
                    continue;
                }
                let skill_md = skill_dir.join("SKILL.md");
                if is_symlink_path(&skill_md) || !skill_md.is_file() {
                    continue;
                }
                let Ok(content) = fs::read_to_string(&skill_md) else {
                    continue;
                };
                let dir_name = entry.file_name().to_string_lossy().into_owned();
                let meta = match parse_skill_metadata(&content, Some(&dir_name)) {
                    Ok(m) => m,
                    Err(_) => continue,
                };
                let key = format!("{scope_label}::{}", dedup_key(&skill_dir));
                if let Some(existing) = seen.get_mut(&key) {
                    if !existing.agents.iter().any(|a| a == spec.id) {
                        existing.agents.push(spec.id.to_string());
                    }
                    continue;
                }
                let lock_entry = lock_by_path.get(&dedup_key(&skill_dir)).copied();
                seen.insert(
                    key,
                    SkillListItem {
                        name: meta.name,
                        description: meta.description,
                        scope: scope_label.to_string(),
                        agents: vec![spec.id.to_string()],
                        path: skill_dir.to_string_lossy().into_owned(),
                        source: lock_entry.map(|e| e.source.clone()),
                        sha256: lock_entry.map(|e| e.sha256.clone()),
                    },
                );
            }
        }
    }

    let mut items: Vec<_> = seen.into_values().collect();
    items.sort_by(|a, b| a.scope.cmp(&b.scope).then_with(|| a.name.cmp(&b.name)));
    Ok(items)
}

pub fn remove_skill(
    name: &str,
    agents: &[String],
    global: bool,
    dry_run: bool,
    project_dir: &Path,
) -> Result<SkillRemoveReport> {
    let valid_name = validate_skill_name(name)?;
    let scope = if global { "global" } else { "project" }.to_string();
    let targets = resolve_remove_targets(agents, global, project_dir)?;

    let mut target_reports = Vec::new();
    let mut removed_paths = Vec::new();

    for target in targets {
        let skill_dir = target.dir.join(&valid_name);
        refuse_if_symlink(&skill_dir, "skill directory")?;
        if !skill_dir.exists() {
            continue;
        }
        if !skill_dir.is_dir() || !skill_dir.join("SKILL.md").is_file() {
            return Err(Error::with_code(
                "HARNESS_E_VALIDATION",
                format!(
                    "Refusing to remove {}: expected a skill directory containing SKILL.md",
                    skill_dir.display()
                ),
            ));
        }
        if !dry_run {
            fs::remove_dir_all(&skill_dir)?;
            removed_paths.push(dedup_key(&skill_dir));
        }
        target_reports.push(SkillRemoveTargetReport {
            agents: target.agents.iter().map(|s| (*s).to_string()).collect(),
            path: skill_dir.to_string_lossy().into_owned(),
            removed: true,
        });
    }

    if target_reports.is_empty() {
        return Err(Error::with_code(
            "HARNESS_E_NOT_FOUND",
            format!("Skill \"{valid_name}\" is not installed in {scope} scope."),
        ));
    }

    if !dry_run && !removed_paths.is_empty() {
        prune_skills_lock(&removed_paths)?;
    }

    Ok(SkillRemoveReport {
        name: valid_name,
        scope,
        dry_run,
        targets: target_reports,
    })
}

pub fn list_agents(project_dir: &Path) -> Vec<AgentInfoReport> {
    let user_home = resolve_user_home();
    SUPPORTED_AGENTS
        .iter()
        .map(|spec| AgentInfoReport {
            id: spec.id.to_string(),
            aliases: spec.aliases.iter().map(|s| (*s).to_string()).collect(),
            display_name: spec.display_name.to_string(),
            project_skills_dir: spec.project_skills_dir.to_string(),
            global_skills_dir: spec.global_skills_dir.to_string(),
            detected_project: spec
                .project_detect_markers
                .iter()
                .any(|m| project_dir.join(m).exists()),
            detected_global: spec
                .global_detect_markers
                .iter()
                .any(|m| user_home.join(m).exists()),
        })
        .collect()
}

pub fn show_skill(name: Option<&str>, project_dir: &Path) -> Result<SkillShowReport> {
    let requested = name
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(BUNDLED_SKILL_NAME);
    if requested.eq_ignore_ascii_case(BUNDLED_SKILL_NAME) {
        let local_skill = project_dir
            .join(".agents")
            .join("skills")
            .join(BUNDLED_SKILL_NAME)
            .join("SKILL.md");
        let (source, content) = if local_skill.is_file() && !is_symlink_path(&local_skill) {
            (
                local_skill.to_string_lossy().into_owned(),
                fs::read_to_string(&local_skill)?,
            )
        } else {
            ("bundled:5harness".to_string(), load_bundled_skill_md())
        };
        let meta = parse_skill_metadata(&content, Some(BUNDLED_SKILL_NAME))?;
        return Ok(SkillShowReport {
            name: meta.name,
            description: meta.description,
            source,
            content,
        });
    }

    let valid = validate_skill_name(requested)?;
    let installed = list_skills(&[], None, project_dir)?;
    if let Some(item) = installed.into_iter().find(|entry| entry.name == valid) {
        let md_path = PathBuf::from(&item.path).join("SKILL.md");
        refuse_if_symlink(&md_path, "SKILL.md")?;
        let content = fs::read_to_string(&md_path)?;
        return Ok(SkillShowReport {
            name: item.name,
            description: item.description,
            source: md_path.to_string_lossy().into_owned(),
            content,
        });
    }

    Err(Error::with_code(
        "HARNESS_E_NOT_FOUND",
        format!("Skill \"{valid}\" not found in project or global directories."),
    ))
}

fn load_skills_from_source(source: &SkillSource) -> Result<Vec<LoadedSkill>> {
    match source {
        SkillSource::Bundled => {
            let content = load_bundled_skill_md();
            let meta = parse_skill_metadata(&content, Some(BUNDLED_SKILL_NAME))?;
            let bytes = content.into_bytes();
            let sha = sha256_bytes(&bytes);
            Ok(vec![LoadedSkill {
                meta,
                source_label: "bundled:5harness".to_string(),
                sha256: sha,
                files: vec![SkillFilePayload {
                    relative: "SKILL.md".to_string(),
                    bytes,
                }],
            }])
        }
        SkillSource::Local(path) => load_local_skills(path, &format!("local:{}", path.display())),
        SkillSource::GitHub { slug, url } => {
            clone_and_load_git_skills(url, &format!("github:{slug}"))
        }
        SkillSource::GitUrl(url) => clone_and_load_git_skills(url, url),
    }
}

struct TempDirGuard(PathBuf);

impl Drop for TempDirGuard {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn clone_and_load_git_skills(url: &str, source_label: &str) -> Result<Vec<LoadedSkill>> {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let tmp_root = env::temp_dir().join(format!("harness-skill-{}-{nonce}", std::process::id()));
    let _guard = TempDirGuard(tmp_root.clone());

    let out = Command::new("git")
        .args([
            "clone",
            "--depth",
            "1",
            "--no-recurse-submodules",
            "--",
            url,
            &tmp_root.to_string_lossy(),
        ])
        .env("GIT_TERMINAL_PROMPT", "0")
        .output()
        .map_err(|err| {
            Error::with_code(
                "HARNESS_E_IO",
                format!("Failed to invoke git to fetch {url}: {err}"),
            )
        })?;

    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(Error::with_code(
            "HARNESS_E_IO",
            format!("Failed to clone skill repository {url}: {}", stderr.trim()),
        ));
    }

    load_local_skills(&tmp_root, source_label)
}

fn load_local_skills(root: &Path, source_label: &str) -> Result<Vec<LoadedSkill>> {
    if !root.exists() {
        return Err(Error::with_code(
            "HARNESS_E_NOT_FOUND",
            format!("Skill source does not exist: {}", root.display()),
        ));
    }
    refuse_if_symlink(root, "skill source")?;

    if root.is_file() {
        let file_name = root.file_name().and_then(|s| s.to_str()).unwrap_or("");
        if !file_name.eq_ignore_ascii_case("SKILL.md") {
            return Err(Error::with_code(
                "HARNESS_E_VALIDATION",
                format!(
                    "Expected a directory or SKILL.md file, got {}",
                    root.display()
                ),
            ));
        }
        let parent_name = root
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|s| s.to_str());
        let skill =
            load_single_skill_dir(root.parent().unwrap_or(root), parent_name, source_label)?;
        return Ok(vec![skill]);
    }

    let mut skill_dirs: Vec<PathBuf> = Vec::new();
    let mut seen_keys = BTreeSet::new();
    collect_skill_dirs(root, 0, &mut seen_keys, &mut skill_dirs)?;

    let mut skills = Vec::new();
    let mut seen_names = BTreeSet::new();
    for dir in skill_dirs {
        let fallback = dir.file_name().and_then(|s| s.to_str());
        let skill = load_single_skill_dir(&dir, fallback, source_label)?;
        if seen_names.insert(skill.meta.name.clone()) {
            skills.push(skill);
        }
    }
    skills.sort_by(|a, b| a.meta.name.cmp(&b.meta.name));
    Ok(skills)
}

fn collect_skill_dirs(
    dir: &Path,
    depth: usize,
    seen: &mut BTreeSet<String>,
    out: &mut Vec<PathBuf>,
) -> Result<()> {
    if depth > 4 || is_symlink_path(dir) || !dir.is_dir() {
        return Ok(());
    }
    let skill_md = dir.join("SKILL.md");
    if skill_md.exists() {
        refuse_if_symlink(&skill_md, "SKILL.md")?;
        if skill_md.is_file() {
            let key = dedup_key(dir);
            if seen.insert(key) {
                out.push(dir.to_path_buf());
            }
            return Ok(());
        }
    }
    if depth == 4 {
        return Ok(());
    }

    let entries = fs::read_dir(dir)?;
    let mut children: Vec<PathBuf> = Vec::new();
    for entry in entries.flatten() {
        let child = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        if matches!(
            name.as_str(),
            ".git" | "node_modules" | "target" | "dist" | "build" | ".5harness"
        ) {
            continue;
        }
        if is_symlink_path(&child) || !child.is_dir() {
            continue;
        }
        children.push(child);
    }
    children.sort();
    for child in children {
        collect_skill_dirs(&child, depth + 1, seen, out)?;
    }
    Ok(())
}

fn load_single_skill_dir(
    dir: &Path,
    fallback_name: Option<&str>,
    source_label: &str,
) -> Result<LoadedSkill> {
    let md_path = dir.join("SKILL.md");
    refuse_if_symlink(&md_path, "SKILL.md")?;
    let content = fs::read_to_string(&md_path)?;
    let meta = parse_skill_metadata(&content, fallback_name)?;
    let md_bytes = content.into_bytes();
    let sha = sha256_bytes(&md_bytes);
    let mut total_bytes = md_bytes.len() as u64;
    let mut files = vec![SkillFilePayload {
        relative: "SKILL.md".to_string(),
        bytes: md_bytes,
    }];

    for sub in SUPPORTING_SUBDIRS {
        let sub_dir = dir.join(sub);
        if !sub_dir.exists() {
            continue;
        }
        refuse_if_symlink(&sub_dir, "supporting skill directory")?;
        if sub_dir.is_dir() {
            collect_supporting_files(&sub_dir, sub, &mut total_bytes, &mut files)?;
        }
    }

    Ok(LoadedSkill {
        meta,
        source_label: source_label.to_string(),
        sha256: sha,
        files,
    })
}

fn collect_supporting_files(
    dir: &Path,
    rel_prefix: &str,
    total_bytes: &mut u64,
    out: &mut Vec<SkillFilePayload>,
) -> Result<()> {
    let mut entries: Vec<_> = fs::read_dir(dir)?.filter_map(|e| e.ok()).collect();
    entries.sort_by_key(|e| e.file_name());
    for entry in entries {
        let path = entry.path();
        refuse_if_symlink(&path, "supporting skill entry")?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name == "." || name == ".." || name.starts_with('.') {
            continue;
        }
        let rel = format!("{rel_prefix}/{name}");
        if path.is_dir() {
            collect_supporting_files(&path, &rel, total_bytes, out)?;
        } else if path.is_file() {
            if out.len() >= MAX_SUPPORTING_FILES {
                return Err(Error::with_code(
                    "HARNESS_E_VALIDATION",
                    format!("Skill exceeds supporting file limit ({MAX_SUPPORTING_FILES})."),
                ));
            }
            let bytes = fs::read(&path)?;
            *total_bytes += bytes.len() as u64;
            if *total_bytes > MAX_SKILL_TOTAL_BYTES {
                return Err(Error::with_code(
                    "HARNESS_E_VALIDATION",
                    format!("Skill payload exceeds {MAX_SKILL_TOTAL_BYTES} bytes limit."),
                ));
            }
            out.push(SkillFilePayload {
                relative: rel,
                bytes,
            });
        }
    }
    Ok(())
}

fn select_skills<'a>(
    loaded: &'a [LoadedSkill],
    opts: &SkillAddOptions,
) -> Result<Vec<&'a LoadedSkill>> {
    if !opts.skills.is_empty() {
        let mut wanted = Vec::new();
        for raw in &opts.skills {
            for part in raw.split(',').map(str::trim).filter(|s| !s.is_empty()) {
                wanted.push(validate_skill_name(part)?);
            }
        }
        let mut chosen = Vec::new();
        for name in wanted {
            let found = loaded.iter().find(|s| s.meta.name == name).ok_or_else(|| {
                let avail: Vec<_> = loaded.iter().map(|s| s.meta.name.as_str()).collect();
                Error::with_code(
                    "HARNESS_E_NOT_FOUND",
                    format!(
                        "Skill \"{name}\" not found in source. Available skills: {}",
                        avail.join(", ")
                    ),
                )
            })?;
            if !chosen
                .iter()
                .any(|s: &&LoadedSkill| s.meta.name == found.meta.name)
            {
                chosen.push(found);
            }
        }
        return Ok(chosen);
    }

    if loaded.len() == 1 || opts.all || opts.yes {
        return Ok(loaded.iter().collect());
    }

    let names: Vec<_> = loaded.iter().map(|s| s.meta.name.as_str()).collect();
    Err(Error::with_code(
        "HARNESS_E_USAGE",
        format!(
            "Multiple skills found ({}). Pass `--skill <name>` or `--all` (or `--yes`) to confirm.",
            names.join(", ")
        ),
    ))
}

fn parse_agent_filter(agents: &[String]) -> Result<Option<Vec<&'static AgentSpec>>> {
    let tokens: Vec<String> = agents
        .iter()
        .flat_map(|item| item.split(','))
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect();
    if tokens.is_empty() {
        return Ok(None);
    }
    if tokens.iter().any(|t| t.eq_ignore_ascii_case("all")) {
        return Ok(Some(SUPPORTED_AGENTS.iter().collect()));
    }
    if tokens.len() == 1 && tokens[0].eq_ignore_ascii_case("auto") {
        return Ok(None);
    }
    let mut specs = Vec::new();
    let mut seen = BTreeSet::new();
    for token in tokens {
        if token.eq_ignore_ascii_case("auto") {
            continue;
        }
        let spec = find_agent_spec(&token)?;
        if seen.insert(spec.id) {
            specs.push(spec);
        }
    }
    Ok(Some(specs))
}

fn resolve_target_agents(
    agents: &[String],
    global: bool,
    project_dir: &Path,
) -> Result<Vec<AgentTarget>> {
    let specs: Vec<&'static AgentSpec> = match parse_agent_filter(agents)? {
        Some(explicit) => explicit,
        None => auto_detect_agents(global, project_dir),
    };
    dedup_agent_targets(&specs, global, project_dir)
}

fn resolve_remove_targets(
    agents: &[String],
    global: bool,
    project_dir: &Path,
) -> Result<Vec<AgentTarget>> {
    let specs: Vec<&'static AgentSpec> = match parse_agent_filter(agents)? {
        Some(explicit) => explicit,
        None => SUPPORTED_AGENTS.iter().collect(),
    };
    dedup_agent_targets(&specs, global, project_dir)
}

fn auto_detect_agents(global: bool, project_dir: &Path) -> Vec<&'static AgentSpec> {
    let user_home = resolve_user_home();
    let mut specs = Vec::new();
    let universal = &SUPPORTED_AGENTS[0];
    specs.push(universal);
    for spec in &SUPPORTED_AGENTS[1..] {
        let detected = if global {
            spec.global_detect_markers
                .iter()
                .any(|m| user_home.join(m).exists())
        } else {
            spec.project_detect_markers
                .iter()
                .any(|m| project_dir.join(m).exists())
        };
        if detected {
            specs.push(spec);
        }
    }
    specs
}

fn dedup_agent_targets(
    specs: &[&'static AgentSpec],
    global: bool,
    project_dir: &Path,
) -> Result<Vec<AgentTarget>> {
    let user_home = resolve_user_home();
    let mut by_key: BTreeMap<String, AgentTarget> = BTreeMap::new();
    for spec in specs {
        let dir = if global {
            user_home.join(spec.global_skills_dir)
        } else {
            project_dir.join(spec.project_skills_dir)
        };
        let key = dedup_key(&dir);
        if let Some(existing) = by_key.get_mut(&key) {
            if !existing.agents.contains(&spec.id) {
                existing.agents.push(spec.id);
            }
        } else {
            by_key.insert(
                key,
                AgentTarget {
                    dir,
                    agents: vec![spec.id],
                },
            );
        }
    }
    Ok(by_key.into_values().collect())
}

fn classify_skill_install_action(skill_root: &Path, files: &[SkillFilePayload]) -> Result<String> {
    if !skill_root.exists() {
        return Ok("created".to_string());
    }
    let mut all_match = true;
    for payload in files {
        let dest = skill_root.join(&payload.relative);
        refuse_if_symlink(&dest, "skill file")?;
        match fs::read(&dest) {
            Ok(existing) if existing == payload.bytes => {}
            _ => {
                all_match = false;
                break;
            }
        }
    }
    Ok(if all_match {
        "unchanged".to_string()
    } else {
        "updated".to_string()
    })
}

fn load_skills_lock() -> Result<SkillsLock> {
    let harness_home = resolve_harness_home();
    let path = skills_lock_file_path(&harness_home);
    if !path.exists() {
        return Ok(SkillsLock {
            version: SKILLS_LOCK_SCHEMA_VERSION,
            entries: Vec::new(),
        });
    }
    refuse_if_symlink(&path, "skills-lock.json")?;
    let raw = fs::read_to_string(&path)?;
    let mut parsed: SkillsLock = serde_json::from_str(&raw).map_err(|err| {
        Error::with_code(
            "HARNESS_E_STATE",
            format!(
                "Corrupt {}: {err}. Remove or inspect the file before retrying.",
                path.display()
            ),
        )
    })?;
    if parsed.version == 0 {
        parsed.version = SKILLS_LOCK_SCHEMA_VERSION;
    }
    Ok(parsed)
}

fn record_skills_lock_updates(updates: &[SkillLockEntry]) -> Result<()> {
    let harness_home = resolve_harness_home();
    ensure_directory_no_symlink(&harness_home)?;
    let path = skills_lock_file_path(&harness_home);
    let mut lock = load_skills_lock()?;
    lock.version = SKILLS_LOCK_SCHEMA_VERSION;
    for item in updates {
        let key = dedup_key(Path::new(&item.path));
        lock.entries.retain(|existing| {
            !(existing.scope == item.scope && dedup_key(Path::new(&existing.path)) == key)
        });
        lock.entries.push(item.clone());
    }
    lock.entries
        .sort_by(|a, b| a.scope.cmp(&b.scope).then_with(|| a.name.cmp(&b.name)));
    let json = serde_json::to_string_pretty(&lock)?;
    atomic_write(&path, &format!("{json}\n"))
}

fn prune_skills_lock(removed_keys: &[String]) -> Result<()> {
    let harness_home = resolve_harness_home();
    let path = skills_lock_file_path(&harness_home);
    if !path.exists() {
        return Ok(());
    }
    let mut lock = load_skills_lock()?;
    let before = lock.entries.len();
    lock.entries
        .retain(|entry| !removed_keys.contains(&dedup_key(Path::new(&entry.path))));
    if lock.entries.len() != before {
        let json = serde_json::to_string_pretty(&lock)?;
        atomic_write(&path, &format!("{json}\n"))?;
    }
    Ok(())
}

fn atomic_write_bytes(path: &Path, bytes: &[u8]) -> Result<()> {
    refuse_if_symlink(path, "target file")?;
    let parent = path.parent().ok_or_else(|| {
        Error::with_code(
            "HARNESS_E_IO",
            format!("Invalid file path: {}", path.display()),
        )
    })?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let tmp = parent.join(format!(
        ".{}.tmp.{}.{nonce}",
        path.file_name().and_then(|s| s.to_str()).unwrap_or("file"),
        std::process::id()
    ));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    fs::rename(&tmp, path)?;
    Ok(())
}

fn refuse_if_symlink(path: &Path, label: &str) -> Result<()> {
    if is_symlink_path(path) {
        return Err(Error::with_code(
            "HARNESS_E_VALIDATION",
            format!(
                "Refusing to traverse or modify symlinked {label}: {}",
                path.display()
            ),
        ));
    }
    Ok(())
}

fn is_symlink_path(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|meta| meta.file_type().is_symlink())
        .unwrap_or(false)
}

fn sha256_bytes(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

fn dedup_key(path: &Path) -> String {
    let raw = path
        .to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string();
    if cfg!(windows) {
        raw.to_ascii_lowercase()
    } else {
        raw
    }
}
