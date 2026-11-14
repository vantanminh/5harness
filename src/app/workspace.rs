use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::{self, BufRead, IsTerminal, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use crate::app::catalog::{build_catalog, by_type, CatalogEntry, ProjectCatalog};
use crate::app::durable::{add_report, get_entity};
use crate::app::index::{checksum_valid, index_json_path, ProjectIndex};
use crate::app::init::run_init;
use crate::app::project_link::ensure_peer_write_allowed;
use crate::domain::frontmatter::{as_string, as_string_array};
use crate::domain::registry::{find_project_by_path, upsert_project};
use crate::domain::workspace::{
    allocate_unique_member_name, clean_path, compute_relative_path, empty_workspace_store,
    match_contract_paths, next_prefixed_id, parse_workspace_manifest_strict, path_is_within,
    resolve_member, suggest_contract_like_files, validate_dep_kind, validate_impact_disposition,
    validate_impact_gate, validate_impact_status, workspace_paths_equal, would_create_dep_cycle,
    ManifestDependency, ManifestMember, WorkspaceDependency, WorkspaceEntry, WorkspaceImpact,
    WorkspaceManifest, WorkspaceMember, WorkspacePolicy, WorkspaceStore,
    WORKSPACE_MANIFEST_VERSION,
};
use crate::error::{Error, Result};
use crate::infra::entities::atomic_write;
use crate::infra::registry::{detect_git_remote, read_registry, write_registry};
use crate::infra::workspace::{
    backup_workspace_store, canonicalize_clean, discover_workspace_candidates, get_workspaces_path,
    git_changed_files, probe_git_info, probe_harness_project, read_workspace_store,
    write_workspace_store, DiscoveredCandidate, DiscoveryReport,
};

pub const DEFAULT_CONTEXT_MAX_CHARS: usize = 12_000;
pub const DEFAULT_CONTEXT_LIMIT: usize = 5;

#[derive(Clone, Debug, Default)]
pub struct LinkWorkspaceOptions {
    pub name: Option<String>,
    pub depth: Option<usize>,
    pub projects: Vec<String>,
    pub excludes: Vec<String>,
    pub all: bool,
    pub yes: bool,
    pub dry_run: bool,
    pub init_missing: bool,
}

#[derive(Clone, Debug)]
pub struct ContextOptions {
    pub task: Option<String>,
    pub project: Option<String>,
    pub role: Option<String>,
    pub limit: usize,
    pub max_chars: usize,
}

impl Default for ContextOptions {
    fn default() -> Self {
        Self {
            task: None,
            project: None,
            role: None,
            limit: DEFAULT_CONTEXT_LIMIT,
            max_chars: DEFAULT_CONTEXT_MAX_CHARS,
        }
    }
}

#[derive(Clone, Debug, Default)]
pub struct ImpactCheckOptions {
    pub source: Option<String>,
    pub story: Option<String>,
    pub since: Option<String>,
    pub include_uncommitted: bool,
    pub create: bool,
    pub emit_reports: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct LinkWorkspaceResult {
    pub dry_run: bool,
    pub workspace: WorkspaceEntry,
    pub discovery: DiscoveryReport,
    pub added: Vec<String>,
    pub updated: Vec<String>,
    pub initialized: Vec<String>,
    pub warnings: Vec<String>,
    pub store_path: PathBuf,
}

fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

pub fn derive_workspace_id(canonical_root: &Path) -> String {
    let key = clean_path(canonical_root).to_string_lossy().into_owned();
    #[cfg(windows)]
    let normalized = key.to_ascii_lowercase();
    #[cfg(not(windows))]
    let normalized = key;
    let digest = Sha256::digest(normalized.as_bytes());
    let hex_str = hex::encode(digest);
    format!("ws-{}", &hex_str[..12])
}

/// Truncate UTF-8 text to at most `max_chars` Unicode scalar values cleanly.
pub fn truncate_utf8_chars(text: &str, max_chars: usize) -> (String, bool) {
    if max_chars == 0 {
        return (String::new(), !text.is_empty());
    }
    let count = text.chars().count();
    if count <= max_chars {
        return (text.to_string(), false);
    }
    let suffix = "...[truncated]";
    let keep = max_chars.saturating_sub(suffix.chars().count());
    let prefix: String = text.chars().take(keep).collect();
    (format!("{prefix}{suffix}"), true)
}

fn resolve_workspace_index(
    store: &WorkspaceStore,
    dir: &Path,
    selector: Option<&str>,
) -> Result<usize> {
    if store.workspaces.is_empty() {
        return Err(Error::with_code(
            "HARNESS_E_NOT_FOUND",
            format!(
                "No workspaces registered. Run `harness workspace link` in a workspace root (checked {}).",
                dir.display()
            ),
        ));
    }
    if let Some(sel) = selector.map(str::trim).filter(|s| !s.is_empty()) {
        let mut exact_matches = Vec::new();
        let mut name_ci_matches = Vec::new();
        for (idx, ws) in store.workspaces.iter().enumerate() {
            if ws.id == sel || ws.name == sel {
                exact_matches.push(idx);
            } else if ws.name.eq_ignore_ascii_case(sel) {
                name_ci_matches.push(idx);
            }
        }
        let chosen = if !exact_matches.is_empty() {
            exact_matches
        } else {
            name_ci_matches
        };
        return match chosen.len() {
            0 => Err(Error::with_code(
                "HARNESS_E_NOT_FOUND",
                format!("Workspace '{sel}' not found. Run `harness workspace list`."),
            )),
            1 => Ok(chosen[0]),
            _ => Err(Error::with_code(
                "HARNESS_E_CONFLICT",
                format!("Workspace selector '{sel}' matches multiple workspaces; pass exact id."),
            )),
        };
    }

    let target = canonicalize_clean(dir).unwrap_or_else(|_| clean_path(dir));
    if let Some((idx, _)) = store
        .workspaces
        .iter()
        .enumerate()
        .find(|(_, ws)| workspace_paths_equal(Path::new(&ws.root_path), &target))
    {
        return Ok(idx);
    }

    // Match nearest ancestor workspace root (useful when running inside a child repo).
    let mut best: Option<(usize, usize)> = None;
    for (idx, ws) in store.workspaces.iter().enumerate() {
        let ws_root = Path::new(&ws.root_path);
        if path_is_within(ws_root, &target) {
            let depth = clean_path(ws_root).components().count();
            if best.is_none_or(|(_, best_depth)| depth > best_depth) {
                best = Some((idx, depth));
            }
        }
    }
    if let Some((idx, _)) = best {
        return Ok(idx);
    }

    Err(Error::with_code(
        "HARNESS_E_NOT_FOUND",
        format!(
            "No workspace registered for {} (or its parents). Preview with `harness workspace discover` and save with `harness workspace link --yes`.",
            target.display()
        ),
    ))
}

fn find_exact_workspace_index(store: &WorkspaceStore, canonical_root: &Path) -> Option<usize> {
    store
        .workspaces
        .iter()
        .position(|ws| workspace_paths_equal(Path::new(&ws.root_path), canonical_root))
}

/// Preview child Git repositories and harnessed projects under `dir`.
pub fn discover_workspace(dir: &Path, depth: Option<usize>) -> Result<DiscoveryReport> {
    discover_workspace_candidates(dir, depth)
}

fn candidate_matches_filter(candidate: &DiscoveredCandidate, filter: &str, root: &Path) -> bool {
    let trimmed = filter.trim().trim_end_matches(&['/', '\\'][..]);
    if trimmed.is_empty() {
        return false;
    }
    let norm = trimmed.replace('\\', "/");
    if candidate.relative_path == norm
        || candidate.name == trimmed
        || candidate.project_id.as_deref() == Some(trimmed)
    {
        return true;
    }
    let raw_path = Path::new(trimmed);
    let abs = if raw_path.is_absolute() {
        raw_path.to_path_buf()
    } else {
        root.join(raw_path)
    };
    if let Ok(canon) = canonicalize_clean(&abs) {
        return workspace_paths_equal(&canon, Path::new(&candidate.path));
    }
    workspace_paths_equal(&clean_path(&abs), Path::new(&candidate.path))
}

fn build_candidate_from_explicit_path(
    canonical_root: &Path,
    selector: &str,
) -> Result<DiscoveredCandidate> {
    let raw = Path::new(selector);
    let candidate_path = if raw.is_absolute() {
        raw.to_path_buf()
    } else {
        canonical_root.join(raw)
    };
    if !candidate_path.exists() {
        return Err(Error::with_code(
            "HARNESS_E_PATH",
            format!(
                "Selected project path does not exist: {}",
                candidate_path.display()
            ),
        ));
    }
    let canonical_member = canonicalize_clean(&candidate_path)?;
    if !canonical_member.is_dir() {
        return Err(Error::with_code(
            "HARNESS_E_PATH",
            format!(
                "Selected project path is not a directory: {}",
                canonical_member.display()
            ),
        ));
    }
    if !path_is_within(canonical_root, &canonical_member) {
        return Err(Error::with_code(
            "HARNESS_E_PATH",
            format!(
                "Selected project {} escapes workspace root {}",
                canonical_member.display(),
                canonical_root.display()
            ),
        ));
    }
    let rel = compute_relative_path(canonical_root, &canonical_member)?;
    if rel == "." {
        return Err(Error::with_code(
            "HARNESS_E_PATH",
            "Workspace root itself cannot be added as a child member via --project",
        ));
    }
    let harness = probe_harness_project(&canonical_member);
    let git = probe_git_info(&canonical_member);
    let name = crate::infra::registry::detect_project_name(&canonical_member);
    let kind = if harness.harnessed && git.is_git_repo {
        "harnessed_git"
    } else if harness.harnessed {
        "harnessed_non_git"
    } else if git.is_git_repo {
        "unharnessed_git"
    } else {
        "explicit_dir"
    };
    Ok(DiscoveredCandidate {
        name,
        path: canonical_member.to_string_lossy().into_owned(),
        relative_path: rel,
        kind: kind.to_string(),
        harnessed: harness.harnessed,
        is_git_repo: git.is_git_repo,
        is_worktree: git.is_worktree,
        worktree_duplicate: false,
        duplicate_of: None,
        nested_under: None,
        project_id: harness.project_id,
        duplicate_id_with: None,
        role: harness.role,
        stack: harness.stack,
        git_common_dir: git.common_dir,
        selected_by_default: true,
    })
}

fn check_duplicate_project_ids(
    selected: &[DiscoveredCandidate],
    canonical_root: &Path,
) -> Result<Vec<String>> {
    let mut warnings = Vec::new();
    let mut seen: BTreeMap<String, (&str, Option<&str>)> = BTreeMap::new();
    for c in selected {
        if let Some(pid) = &c.project_id {
            if let Some((prev_path, prev_common)) = seen.get(pid) {
                let same_worktree =
                    prev_common.is_some() && c.git_common_dir.as_deref() == *prev_common;
                if same_worktree {
                    return Err(Error::with_code(
                        "HARNESS_E_CONFLICT",
                        format!(
                            "Both {} and {} belong to the same Git repository worktree; omit duplicate worktrees.",
                            prev_path, c.path
                        ),
                    ));
                }
                return Err(Error::with_code(
                    "HARNESS_E_CONFLICT",
                    format!(
                        "Duplicate harness-project-id '{pid}' detected across {} and {}. Fix one repo's AGENTS.md id before linking.",
                        prev_path, c.path
                    ),
                ));
            }
            seen.insert(pid.clone(), (&c.path, c.git_common_dir.as_deref()));
        }
    }

    // Check against registry for existing paths outside this workspace that hold the same project_id.
    let registry = read_registry();
    for c in selected {
        let Some(pid) = &c.project_id else {
            continue;
        };
        for reg in &registry.projects {
            if reg.id != *pid {
                continue;
            }
            let reg_path = Path::new(&reg.path);
            let same_path = canonicalize_clean(reg_path)
                .map(|canon| workspace_paths_equal(&canon, Path::new(&c.path)))
                .unwrap_or_else(|_| workspace_paths_equal(reg_path, Path::new(&c.path)));
            if same_path {
                continue;
            }
            if !reg_path.exists() {
                warnings.push(format!(
                    "Registry entry for {pid} previously pointed to missing path {}; workspace link will preserve safe state.",
                    reg.path
                ));
                continue;
            }
            let reg_git = probe_git_info(reg_path);
            let same_repo = c.git_common_dir.is_some()
                && reg_git.common_dir.is_some()
                && c.git_common_dir.as_deref() == reg_git.common_dir.as_deref();
            let same_ws = path_is_within(canonical_root, reg_path);
            if !same_repo && !same_ws {
                return Err(Error::with_code(
                    "HARNESS_E_CONFLICT",
                    format!(
                        "Project id '{pid}' at {} conflicts with existing registered project at {}. Regenerate or deduplicate project id before linking.",
                        c.path, reg.path
                    ),
                ));
            }
        }
    }
    Ok(warnings)
}

fn sync_harnessed_members_to_registry(members: &[WorkspaceMember]) -> Result<()> {
    let mut registry = read_registry();
    let now = now_iso();
    let mut changed = false;
    for member in members {
        if !member.harnessed {
            continue;
        }
        let Some(pid) = member.project_id.clone() else {
            continue;
        };
        let path = Path::new(&member.path);
        if !path.is_dir() {
            continue;
        }
        // Only register if not already registered with same id and same canonical path.
        if let Some(existing) = find_project_by_path(&registry, path) {
            if existing.id == pid {
                continue;
            }
        }
        let remote = detect_git_remote(path);
        let (next, _, _) = upsert_project(&registry, Some(pid), path, &member.name, remote, &now)
            .map_err(Error::new)?;
        registry = next;
        changed = true;
    }
    if changed {
        write_registry(&registry)?;
    }
    Ok(())
}

/// Discover and register a workspace in `$HARNESS_HOME/workspaces.json`.
/// Never creates files in the parent workspace directory, and never runs `harness init`
/// on child projects unless `opts.init_missing` is explicitly true.
pub fn link_workspace(dir: &Path, opts: &LinkWorkspaceOptions) -> Result<LinkWorkspaceResult> {
    let canonical_root = canonicalize_clean(dir).map_err(|err| {
        Error::with_code(
            "HARNESS_E_PATH",
            format!(
                "Workspace directory {} cannot be accessed: {err}",
                dir.display()
            ),
        )
    })?;
    if !canonical_root.is_dir() {
        return Err(Error::with_code(
            "HARNESS_E_PATH",
            format!(
                "Workspace path is not a directory: {}",
                canonical_root.display()
            ),
        ));
    }

    let mut store = read_workspace_store()?;
    let discovery = discover_workspace_candidates(&canonical_root, opts.depth)?;
    let mut warnings = discovery.warnings.clone();

    let mut selected: Vec<DiscoveredCandidate> = Vec::new();
    if opts.projects.is_empty() {
        for cand in &discovery.candidates {
            let excluded = opts
                .excludes
                .iter()
                .any(|ex| candidate_matches_filter(cand, ex, &canonical_root));
            if excluded {
                continue;
            }
            let include = if opts.all {
                !cand.worktree_duplicate && cand.duplicate_id_with.is_none()
            } else {
                cand.selected_by_default
            };
            if include {
                selected.push(cand.clone());
            }
        }
    } else {
        for sel in &opts.projects {
            if let Some(found) = discovery
                .candidates
                .iter()
                .find(|c| candidate_matches_filter(c, sel, &canonical_root))
            {
                if found.worktree_duplicate {
                    return Err(Error::with_code(
                        "HARNESS_E_CONFLICT",
                        format!(
                            "Selected path {} is a duplicate Git worktree of {}; link the primary repo instead.",
                            found.path,
                            found.duplicate_of.as_deref().unwrap_or("primary repository")
                        ),
                    ));
                }
                if !selected.iter().any(|s| s.path == found.path) {
                    selected.push(found.clone());
                }
            } else {
                let explicit = build_candidate_from_explicit_path(&canonical_root, sel)?;
                if !selected.iter().any(|s| s.path == explicit.path) {
                    selected.push(explicit);
                }
            }
        }
        selected.retain(|cand| {
            !opts
                .excludes
                .iter()
                .any(|ex| candidate_matches_filter(cand, ex, &canonical_root))
        });
    }

    // Check duplicate common_dir among explicit selections as well.
    let mut seen_common: BTreeMap<String, String> = BTreeMap::new();
    for cand in &selected {
        if let Some(common) = &cand.git_common_dir {
            let key = common.to_ascii_lowercase();
            if let Some(prev) = seen_common.get(&key) {
                return Err(Error::with_code(
                    "HARNESS_E_CONFLICT",
                    format!(
                        "Selected paths {} and {} share Git common dir {}; only one worktree may be linked.",
                        prev, cand.path, common
                    ),
                ));
            }
            seen_common.insert(key, cand.path.clone());
        }
    }

    warnings.extend(check_duplicate_project_ids(&selected, &canonical_root)?);

    let ws_id = derive_workspace_id(&canonical_root);
    let existing_idx = find_exact_workspace_index(&store, &canonical_root);
    let default_name = canonical_root
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "workspace".to_string());
    let ws_name = opts
        .name
        .clone()
        .or_else(|| existing_idx.map(|i| store.workspaces[i].name.clone()))
        .unwrap_or(default_name);

    let now = now_iso();
    let existing = existing_idx.map(|i| store.workspaces[i].clone());
    let mut used_names: Vec<String> = Vec::new();
    let mut new_members = Vec::new();
    let mut added = Vec::new();
    let mut updated = Vec::new();
    let mut initialized = Vec::new();

    if !opts.dry_run && !opts.yes && !opts.all && opts.projects.is_empty() && existing.is_none() {
        if io::stdin().is_terminal() && io::stdout().is_terminal() {
            println!(
                "Workspace preview for {} ({} selected, {} total discovered):",
                canonical_root.display(),
                selected.len(),
                discovery.candidates.len()
            );
            for cand in &selected {
                println!(
                    "  [x] {} ({})  harnessed={}",
                    cand.relative_path, cand.kind, cand.harnessed
                );
            }
            print!(
                "Save this workspace link to {}? [y/N] ",
                get_workspaces_path().display()
            );
            io::stdout().flush()?;
            let mut answer = String::new();
            io::stdin().lock().read_line(&mut answer)?;
            let ans = answer.trim().to_ascii_lowercase();
            if ans != "y" && ans != "yes" {
                return Err(Error::new("Workspace link cancelled."));
            }
        } else {
            return Err(Error::with_code(
                "HARNESS_E_CONFIRMATION_REQUIRED",
                "Refusing to save workspace links without explicit confirmation in non-interactive mode. Run `harness workspace discover` (or `link --dry-run`) to preview, then pass `--yes`, `--all`, or `--project <path>`.",
            ));
        }
    }

    // Preserve existing members when adding targeted `--project` picks to an already-linked workspace,
    // or rebuild selection cleanly when linking/re-linking workspace root without `--project`.
    if let Some(prev) = &existing {
        if !opts.projects.is_empty() {
            for m in &prev.projects {
                used_names.push(m.name.clone());
                new_members.push(m.clone());
            }
        }
    }

    for cand in &selected {
        let mut effective_harnessed = cand.harnessed;
        let mut effective_pid = cand.project_id.clone();
        let mut effective_role = cand.role.clone();

        if !opts.dry_run && opts.init_missing && !effective_harnessed {
            run_init(Some(&cand.path), false, false, &canonical_root, true)?;
            let reprobed = probe_harness_project(Path::new(&cand.path));
            effective_harnessed = reprobed.harnessed;
            effective_pid = reprobed.project_id;
            effective_role = reprobed.role;
            initialized.push(cand.relative_path.clone());
        }

        if let Some(existing_pos) = new_members
            .iter()
            .position(|m| workspace_paths_equal(Path::new(&m.path), Path::new(&cand.path)))
        {
            let prev = &mut new_members[existing_pos];
            prev.relative_path = cand.relative_path.clone();
            prev.project_id = effective_pid;
            prev.role = effective_role.or(prev.role.clone());
            prev.harnessed = effective_harnessed;
            prev.git_common_dir = cand.git_common_dir.clone();
            updated.push(prev.name.clone());
            continue;
        }

        let prev_member = existing.as_ref().and_then(|e| {
            e.projects
                .iter()
                .find(|m| workspace_paths_equal(Path::new(&m.path), Path::new(&cand.path)))
        });
        let name = if let Some(pm) = prev_member {
            if !used_names.contains(&pm.name) {
                pm.name.clone()
            } else {
                allocate_unique_member_name(&used_names, &cand.name, &cand.relative_path)
            }
        } else {
            allocate_unique_member_name(&used_names, &cand.name, &cand.relative_path)
        };
        used_names.push(name.clone());
        if prev_member.is_some() {
            updated.push(name.clone());
        } else {
            added.push(name.clone());
        }
        new_members.push(WorkspaceMember {
            name,
            path: cand.path.clone(),
            relative_path: cand.relative_path.clone(),
            project_id: effective_pid,
            role: effective_role.or_else(|| prev_member.and_then(|p| p.role.clone())),
            harnessed: effective_harnessed,
            git_common_dir: cand.git_common_dir.clone(),
            added_at: prev_member
                .map(|p| p.added_at.clone())
                .unwrap_or_else(|| now.clone()),
        });
    }

    // Re-run duplicate project_id check after any `--init-missing` updates.
    if !initialized.is_empty() {
        let mut seen = BTreeSet::new();
        for m in &new_members {
            if let Some(pid) = &m.project_id {
                if !seen.insert(pid.clone()) {
                    return Err(Error::with_code(
                        "HARNESS_E_CONFLICT",
                        format!("Duplicate project_id '{pid}' in workspace after initialization."),
                    ));
                }
            }
        }
    }

    let workspace = WorkspaceEntry {
        id: ws_id,
        name: ws_name,
        root_path: canonical_root.to_string_lossy().into_owned(),
        policy: existing
            .as_ref()
            .map(|e| e.policy.clone())
            .unwrap_or_default(),
        projects: new_members,
        dependencies: existing
            .as_ref()
            .map(|e| e.dependencies.clone())
            .unwrap_or_default(),
        impacts: existing
            .as_ref()
            .map(|e| e.impacts.clone())
            .unwrap_or_default(),
        created_at: existing
            .as_ref()
            .map(|e| e.created_at.clone())
            .unwrap_or_else(|| now.clone()),
        updated_at: now,
    };

    let store_path = if opts.dry_run {
        get_workspaces_path()
    } else {
        match existing_idx {
            Some(idx) => store.workspaces[idx] = workspace.clone(),
            None => store.workspaces.push(workspace.clone()),
        }
        let saved = write_workspace_store(&store)?;
        sync_harnessed_members_to_registry(&workspace.projects)?;
        saved
    };

    Ok(LinkWorkspaceResult {
        dry_run: opts.dry_run,
        workspace,
        discovery,
        added,
        updated,
        initialized,
        warnings,
        store_path,
    })
}

pub fn list_workspaces() -> Result<Vec<WorkspaceEntry>> {
    Ok(read_workspace_store()?.workspaces)
}

pub fn add_member_to_workspace(
    dir: &Path,
    workspace_sel: Option<&str>,
    member_path_input: &str,
    name_override: Option<&str>,
    init_missing: bool,
) -> Result<WorkspaceEntry> {
    let mut store = read_workspace_store()?;
    let idx = resolve_workspace_index(&store, dir, workspace_sel)?;
    let ws_root = PathBuf::from(&store.workspaces[idx].root_path);
    let mut cand = build_candidate_from_explicit_path(&ws_root, member_path_input)?;

    if !cand.harnessed && init_missing {
        run_init(Some(&cand.path), false, false, &ws_root, true)?;
        let probe = probe_harness_project(Path::new(&cand.path));
        cand.harnessed = probe.harnessed;
        cand.project_id = probe.project_id;
        cand.role = probe.role;
    }

    let ws = &mut store.workspaces[idx];
    if let Some(existing) = ws
        .projects
        .iter()
        .find(|m| workspace_paths_equal(Path::new(&m.path), Path::new(&cand.path)))
    {
        // Idempotent refresh of metadata on repeat `add`.
        let name = existing.name.clone();
        let added_at = existing.added_at.clone();
        let existing_role = existing.role.clone();
        if let Some(m) = ws.projects.iter_mut().find(|m| m.name == name) {
            m.relative_path = cand.relative_path;
            m.project_id = cand.project_id;
            m.role = cand.role.or(existing_role);
            m.harnessed = cand.harnessed;
            m.git_common_dir = cand.git_common_dir;
            m.added_at = added_at;
        }
        ws.updated_at = now_iso();
        let out = ws.clone();
        write_workspace_store(&store)?;
        sync_harnessed_members_to_registry(&out.projects)?;
        return Ok(out);
    }

    if let Some(common) = &cand.git_common_dir {
        if let Some(dup) = ws.projects.iter().find(|m| {
            m.git_common_dir
                .as_deref()
                .is_some_and(|c| c.eq_ignore_ascii_case(common))
        }) {
            return Err(Error::with_code(
                "HARNESS_E_CONFLICT",
                format!(
                    "Member '{}' ({}) already shares Git repository common dir {common}",
                    dup.name, dup.path
                ),
            ));
        }
    }
    if let Some(pid) = &cand.project_id {
        if let Some(dup) = ws
            .projects
            .iter()
            .find(|m| m.project_id.as_deref() == Some(pid.as_str()))
        {
            return Err(Error::with_code(
                "HARNESS_E_CONFLICT",
                format!(
                    "Member '{}' ({}) already has project_id '{pid}'",
                    dup.name, dup.path
                ),
            ));
        }
    }

    let existing_names: Vec<String> = ws.projects.iter().map(|m| m.name.clone()).collect();
    let member_name = if let Some(custom) = name_override.map(str::trim).filter(|s| !s.is_empty()) {
        if existing_names.iter().any(|n| n == custom) {
            return Err(Error::with_code(
                "HARNESS_E_CONFLICT",
                format!("Workspace already contains a member named '{custom}'"),
            ));
        }
        custom.to_string()
    } else {
        allocate_unique_member_name(&existing_names, &cand.name, &cand.relative_path)
    };

    ws.projects.push(WorkspaceMember {
        name: member_name,
        path: cand.path,
        relative_path: cand.relative_path,
        project_id: cand.project_id,
        role: cand.role,
        harnessed: cand.harnessed,
        git_common_dir: cand.git_common_dir,
        added_at: now_iso(),
    });
    ws.updated_at = now_iso();
    let out = ws.clone();
    write_workspace_store(&store)?;
    sync_harnessed_members_to_registry(&out.projects)?;
    Ok(out)
}

pub fn remove_member_from_workspace(
    dir: &Path,
    workspace_sel: Option<&str>,
    member_sel: &str,
) -> Result<(WorkspaceEntry, String)> {
    let mut store = read_workspace_store()?;
    let idx = resolve_workspace_index(&store, dir, workspace_sel)?;
    let ws = &mut store.workspaces[idx];
    let member_name = resolve_member(ws, member_sel)?.name.clone();
    let has_deps = ws
        .dependencies
        .iter()
        .any(|d| d.from == member_name || d.to == member_name);
    let has_open_impacts = ws.impacts.iter().any(|i| {
        (i.source_member == member_name || i.target_member == member_name) && i.status == "pending"
    });
    if has_deps || has_open_impacts {
        return Err(Error::with_code(
            "HARNESS_E_CONFLICT",
            format!(
                "Cannot remove member '{member_name}' while dependencies or pending impacts reference it. Remove/resolve them first."
            ),
        ));
    }
    ws.projects.retain(|m| m.name != member_name);
    ws.updated_at = now_iso();
    let out = ws.clone();
    write_workspace_store(&store)?;
    Ok((out, member_name))
}

pub fn unlink_workspace(dir: &Path, workspace_sel: Option<&str>) -> Result<WorkspaceEntry> {
    let mut store = read_workspace_store()?;
    let idx = resolve_workspace_index(&store, dir, workspace_sel)?;
    let removed = store.workspaces.remove(idx);
    write_workspace_store(&store)?;
    Ok(removed)
}

/// Reconcile registered workspace member paths against disk (detecting moved projects
/// by `project_id` and optionally pruning missing members). Does not auto-delete without `--prune-missing`.
pub fn reconcile_workspace(
    dir: &Path,
    workspace_sel: Option<&str>,
    depth: Option<usize>,
    prune_missing: bool,
    dry_run: bool,
) -> Result<Value> {
    let mut store = read_workspace_store()?;
    let idx = resolve_workspace_index(&store, dir, workspace_sel)?;
    let ws = &mut store.workspaces[idx];
    let ws_root = PathBuf::from(&ws.root_path);
    if !ws_root.is_dir() {
        return Err(Error::with_code(
            "HARNESS_E_PATH",
            format!(
                "Workspace root no longer exists on disk: {}",
                ws_root.display()
            ),
        ));
    }
    let discovery = discover_workspace_candidates(&ws_root, depth)?;
    let mut by_id: BTreeMap<String, &DiscoveredCandidate> = BTreeMap::new();
    for cand in &discovery.candidates {
        if let Some(pid) = &cand.project_id {
            by_id.entry(pid.clone()).or_insert(cand);
        }
    }

    let mut relinked = Vec::new();
    let mut refreshed = Vec::new();
    let mut missing = Vec::new();
    let mut pruned = Vec::new();
    let mut kept_members = Vec::with_capacity(ws.projects.len());

    for mut member in ws.projects.clone() {
        let mpath = PathBuf::from(&member.path);
        if mpath.is_dir() {
            let harness = probe_harness_project(&mpath);
            let git = probe_git_info(&mpath);
            member.harnessed = harness.harnessed;
            member.project_id = harness.project_id.or(member.project_id);
            member.role = harness.role.or(member.role);
            member.git_common_dir = git.common_dir;
            refreshed.push(member.name.clone());
            kept_members.push(member);
            continue;
        }
        // Path missing on disk; attempt match by durable project_id inside workspace.
        if let Some(pid) = &member.project_id {
            if let Some(found) = by_id.get(pid) {
                let old_path = member.path.clone();
                member.path = found.path.clone();
                member.relative_path = found.relative_path.clone();
                member.harnessed = found.harnessed;
                member.role = found.role.clone().or(member.role);
                member.git_common_dir = found.git_common_dir.clone();
                relinked.push(json!({
                    "name": member.name,
                    "project_id": pid,
                    "old_path": old_path,
                    "new_path": member.path,
                }));
                kept_members.push(member);
                continue;
            }
        }
        if prune_missing {
            pruned.push(member.name.clone());
        } else {
            missing.push(json!({
                "name": member.name,
                "path": member.path,
                "project_id": member.project_id,
            }));
            kept_members.push(member);
        }
    }

    if !dry_run && (!relinked.is_empty() || !pruned.is_empty() || !refreshed.is_empty()) {
        ws.projects = kept_members;
        ws.updated_at = now_iso();
        let saved_projects = ws.projects.clone();
        write_workspace_store(&store)?;
        sync_harnessed_members_to_registry(&saved_projects)?;
    }

    Ok(json!({
        "dry_run": dry_run,
        "workspace_id": store.workspaces[idx].id,
        "workspace_name": store.workspaces[idx].name,
        "relinked": relinked,
        "refreshed": refreshed,
        "missing": missing,
        "pruned": pruned,
    }))
}

pub fn doctor_workspace(dir: &Path, workspace_sel: Option<&str>, repair: bool) -> Result<Value> {
    let store_path = get_workspaces_path();
    let store = match read_workspace_store() {
        Ok(s) => s,
        Err(err) if repair => {
            let backup = backup_workspace_store()?;
            let fresh = empty_workspace_store();
            let written = write_workspace_store(&fresh)?;
            return Ok(json!({
                "repaired": true,
                "previous_error": err.message,
                "backup_path": backup,
                "store_path": written,
                "workspaces": 0,
            }));
        }
        Err(err) => return Err(err),
    };

    if store.workspaces.is_empty() {
        return Ok(json!({
            "healthy": true,
            "store_path": store_path,
            "workspaces": 0,
            "warnings": [],
        }));
    }

    // If running inside or targeting a specific workspace, inspect it; otherwise check all.
    let target_indices: Vec<usize> = match resolve_workspace_index(&store, dir, workspace_sel) {
        Ok(i) => vec![i],
        Err(_) if workspace_sel.is_none() => (0..store.workspaces.len()).collect(),
        Err(err) => return Err(err),
    };

    let mut reports = Vec::new();
    let mut all_ok = true;
    for idx in target_indices {
        let ws = &store.workspaces[idx];
        let mut issues = Vec::new();
        let ws_root = Path::new(&ws.root_path);
        if !ws_root.is_dir() {
            all_ok = false;
            issues.push(format!("Workspace root missing: {}", ws.root_path));
        }
        let mut seen_ids = BTreeSet::new();
        let mut member_health = Vec::new();
        for m in &ws.projects {
            let mh = probe_member_health(ws_root, m);
            if mh["status"] != "ok" {
                all_ok = false;
            }
            if let Some(pid) = &m.project_id {
                if !seen_ids.insert(pid.clone()) {
                    all_ok = false;
                    issues.push(format!("Duplicate project_id in workspace: {pid}"));
                }
            }
            member_health.push(mh);
        }
        for dep in &ws.dependencies {
            if resolve_member(ws, &dep.from).is_err() || resolve_member(ws, &dep.to).is_err() {
                all_ok = false;
                issues.push(format!(
                    "Dangling dependency {}: {} -> {}",
                    dep.id, dep.from, dep.to
                ));
            }
        }
        reports.push(json!({
            "id": ws.id,
            "name": ws.name,
            "root_path": ws.root_path,
            "issues": issues,
            "members": member_health,
        }));
    }

    Ok(json!({
        "healthy": all_ok,
        "store_path": store_path,
        "workspaces": reports,
    }))
}

pub fn export_workspace_manifest(
    dir: &Path,
    workspace_sel: Option<&str>,
    out_path: &Path,
) -> Result<Value> {
    let store = read_workspace_store()?;
    let idx = resolve_workspace_index(&store, dir, workspace_sel)?;
    let ws = &store.workspaces[idx];
    let ws_root = canonicalize_clean(Path::new(&ws.root_path))
        .unwrap_or_else(|_| clean_path(Path::new(&ws.root_path)));
    let resolved_out = if out_path.is_absolute() {
        out_path.to_path_buf()
    } else {
        dir.join(out_path)
    };
    if let Some(parent) = resolved_out.parent() {
        fs::create_dir_all(parent)?;
    }
    let canon_parent = canonicalize_clean(
        resolved_out
            .parent()
            .ok_or_else(|| Error::new("Manifest path has no parent directory"))?,
    )?;
    if !path_is_within(&ws_root, &canon_parent) {
        return Err(Error::with_code(
            "HARNESS_E_PATH",
            format!(
                "Manifest export path {} escapes workspace root {}",
                resolved_out.display(),
                ws_root.display()
            ),
        ));
    }
    let manifest = WorkspaceManifest {
        version: WORKSPACE_MANIFEST_VERSION,
        name: ws.name.clone(),
        policy: ws.policy.clone(),
        members: ws
            .projects
            .iter()
            .map(|m| ManifestMember {
                name: m.name.clone(),
                relative_path: m.relative_path.clone(),
                project_id: m.project_id.clone(),
                role: m.role.clone(),
            })
            .collect(),
        dependencies: ws
            .dependencies
            .iter()
            .map(|d| ManifestDependency {
                from: d.from.clone(),
                to: d.to.clone(),
                kind: d.kind.clone(),
                required: d.required,
                contract_paths: d.contract_paths.clone(),
                notes: d.notes.clone(),
            })
            .collect(),
    };
    let payload = format!("{}\n", serde_json::to_string_pretty(&manifest)?);
    atomic_write(&resolved_out, &payload)?;
    Ok(json!({
        "manifest_path": resolved_out,
        "workspace_id": ws.id,
        "members": manifest.members.len(),
        "dependencies": manifest.dependencies.len(),
    }))
}

pub fn apply_workspace_manifest(dir: &Path, manifest_path: &Path) -> Result<WorkspaceEntry> {
    let canonical_root = canonicalize_clean(dir)?;
    let resolved = if manifest_path.is_absolute() {
        manifest_path.to_path_buf()
    } else {
        dir.join(manifest_path)
    };
    let raw = fs::read_to_string(&resolved)?;
    let manifest = parse_workspace_manifest_strict(&raw)?;

    let mut store = read_workspace_store()?;
    let now = now_iso();
    let existing_idx = find_exact_workspace_index(&store, &canonical_root);
    let existing = existing_idx.map(|i| store.workspaces[i].clone());
    let mut members = Vec::new();
    let mut seen_ids = BTreeSet::new();
    let mut seen_common = BTreeSet::new();

    for m in &manifest.members {
        let joined = canonical_root.join(Path::new(&m.relative_path));
        if !joined.is_dir() {
            return Err(Error::with_code(
                "HARNESS_E_PATH",
                format!(
                    "Manifest member '{}' directory does not exist: {}",
                    m.name,
                    joined.display()
                ),
            ));
        }
        let canon_member = canonicalize_clean(&joined)?;
        if !path_is_within(&canonical_root, &canon_member) {
            return Err(Error::with_code(
                "HARNESS_E_PATH",
                format!(
                    "Manifest member '{}' escapes workspace root {}",
                    m.name,
                    canonical_root.display()
                ),
            ));
        }
        let harness = probe_harness_project(&canon_member);
        let git = probe_git_info(&canon_member);
        if let (Some(expected_pid), Some(actual_pid)) = (&m.project_id, &harness.project_id) {
            if expected_pid != actual_pid {
                return Err(Error::with_code(
                    "HARNESS_E_CONFLICT",
                    format!(
                        "Manifest member '{}' expected project_id '{expected_pid}', found '{actual_pid}'",
                        m.name
                    ),
                ));
            }
        }
        let effective_pid = harness.project_id.or_else(|| m.project_id.clone());
        if let Some(pid) = &effective_pid {
            if !seen_ids.insert(pid.clone()) {
                return Err(Error::with_code(
                    "HARNESS_E_CONFLICT",
                    format!("Manifest has duplicate project_id '{pid}'"),
                ));
            }
        }
        if let Some(common) = &git.common_dir {
            if !seen_common.insert(common.to_ascii_lowercase()) {
                return Err(Error::with_code(
                    "HARNESS_E_CONFLICT",
                    format!("Manifest includes multiple Git worktrees for {common}"),
                ));
            }
        }
        members.push(WorkspaceMember {
            name: m.name.clone(),
            path: canon_member.to_string_lossy().into_owned(),
            relative_path: m.relative_path.replace('\\', "/"),
            project_id: effective_pid,
            role: harness.role.or_else(|| m.role.clone()),
            harnessed: harness.harnessed,
            git_common_dir: git.common_dir,
            added_at: now.clone(),
        });
    }

    let mut deps = Vec::new();
    for md in &manifest.dependencies {
        if !members.iter().any(|m| m.name == md.from) || !members.iter().any(|m| m.name == md.to) {
            return Err(Error::new(format!(
                "Manifest dependency {} -> {} references unknown member",
                md.from, md.to
            )));
        }
        let kind = validate_dep_kind(&md.kind)?;
        if would_create_dep_cycle(&deps, &md.from, &md.to) {
            return Err(Error::with_code(
                "HARNESS_E_CONFLICT",
                format!(
                    "Manifest dependency {} -> {} creates a dependency cycle",
                    md.from, md.to
                ),
            ));
        }
        let dep_id = next_prefixed_id(
            deps.iter().map(|d: &WorkspaceDependency| d.id.clone()),
            "DEP-",
        );
        deps.push(WorkspaceDependency {
            id: dep_id,
            from: md.from.clone(),
            to: md.to.clone(),
            kind,
            required: md.required,
            contract_paths: md.contract_paths.clone(),
            notes: md.notes.clone(),
            created_at: now.clone(),
        });
    }

    let ws = WorkspaceEntry {
        id: derive_workspace_id(&canonical_root),
        name: manifest.name,
        root_path: canonical_root.to_string_lossy().into_owned(),
        policy: manifest.policy,
        projects: members,
        dependencies: deps,
        impacts: existing
            .as_ref()
            .map(|e| e.impacts.clone())
            .unwrap_or_default(),
        created_at: existing
            .as_ref()
            .map(|e| e.created_at.clone())
            .unwrap_or_else(|| now.clone()),
        updated_at: now,
    };

    match existing_idx {
        Some(idx) => store.workspaces[idx] = ws.clone(),
        None => store.workspaces.push(ws.clone()),
    }
    write_workspace_store(&store)?;
    sync_harnessed_members_to_registry(&ws.projects)?;
    Ok(ws)
}

pub fn set_workspace_policy(
    dir: &Path,
    workspace_sel: Option<&str>,
    impact_gate: Option<&str>,
    require_on_contract_story: Option<bool>,
) -> Result<WorkspacePolicy> {
    if impact_gate.is_none() && require_on_contract_story.is_none() {
        return Err(Error::new(
            "workspace policy requires --impact-gate or --require-contract-story",
        ));
    }
    let mut store = read_workspace_store()?;
    let idx = resolve_workspace_index(&store, dir, workspace_sel)?;
    let ws = &mut store.workspaces[idx];
    if let Some(gate) = impact_gate {
        ws.policy.impact_gate = validate_impact_gate(gate)?;
    }
    if let Some(req) = require_on_contract_story {
        ws.policy.require_impact_on_contract_story = req;
    }
    ws.updated_at = now_iso();
    let policy = ws.policy.clone();
    write_workspace_store(&store)?;
    Ok(policy)
}

#[allow(clippy::too_many_arguments)]
pub fn add_dependency(
    dir: &Path,
    workspace_sel: Option<&str>,
    from_sel: &str,
    to_sel: &str,
    kind: &str,
    required: bool,
    contract_paths: Vec<String>,
    notes: Option<&str>,
) -> Result<(WorkspaceDependency, bool)> {
    let mut store = read_workspace_store()?;
    let idx = resolve_workspace_index(&store, dir, workspace_sel)?;
    let ws = &mut store.workspaces[idx];
    let from = resolve_member(ws, from_sel)?.name.clone();
    let to = resolve_member(ws, to_sel)?.name.clone();
    let kind = validate_dep_kind(kind)?;
    let clean_paths: Vec<String> = contract_paths
        .into_iter()
        .map(|s| s.trim().replace('\\', "/"))
        .filter(|s| !s.is_empty())
        .collect();

    if let Some(existing) = ws
        .dependencies
        .iter_mut()
        .find(|d| d.from == from && d.to == to && d.kind == kind)
    {
        existing.required = required;
        if !clean_paths.is_empty() {
            existing.contract_paths = clean_paths;
        }
        if let Some(n) = notes {
            existing.notes = Some(n.to_string());
        }
        let dep = existing.clone();
        ws.updated_at = now_iso();
        write_workspace_store(&store)?;
        return Ok((dep, false));
    }

    if would_create_dep_cycle(&ws.dependencies, &from, &to) {
        return Err(Error::with_code(
            "HARNESS_E_CONFLICT",
            format!("Adding dependency {from} -> {to} creates a circular dependency."),
        ));
    }

    let id = next_prefixed_id(ws.dependencies.iter().map(|d| d.id.clone()), "DEP-");
    let dep = WorkspaceDependency {
        id,
        from,
        to,
        kind,
        required,
        contract_paths: clean_paths,
        notes: notes.map(str::to_string),
        created_at: now_iso(),
    };
    ws.dependencies.push(dep.clone());
    ws.updated_at = now_iso();
    write_workspace_store(&store)?;
    Ok((dep, true))
}

pub fn remove_dependency(dir: &Path, workspace_sel: Option<&str>, dep_id: &str) -> Result<bool> {
    let mut store = read_workspace_store()?;
    let idx = resolve_workspace_index(&store, dir, workspace_sel)?;
    let ws = &mut store.workspaces[idx];
    let before = ws.dependencies.len();
    ws.dependencies.retain(|d| d.id != dep_id);
    if ws.dependencies.len() == before {
        return Ok(false);
    }
    ws.updated_at = now_iso();
    write_workspace_store(&store)?;
    Ok(true)
}

pub fn list_dependencies(
    dir: &Path,
    workspace_sel: Option<&str>,
) -> Result<Vec<WorkspaceDependency>> {
    let store = read_workspace_store()?;
    let idx = resolve_workspace_index(&store, dir, workspace_sel)?;
    Ok(store.workspaces[idx].dependencies.clone())
}

/// Inspect a member read-only without mutating its `.5harness/` directory.
fn probe_member_health(ws_root: &Path, member: &WorkspaceMember) -> Value {
    let path = Path::new(&member.path);
    if !path.exists() {
        return json!({
            "name": member.name,
            "relative_path": member.relative_path,
            "path": member.path,
            "role": member.role,
            "project_id": member.project_id,
            "harnessed": member.harnessed,
            "status": "missing",
            "error": format!("Project directory not found at {}. Run `harness workspace reconcile` if moved.", member.path),
        });
    }
    if let Err(err) = fs::read_dir(path) {
        return json!({
            "name": member.name,
            "relative_path": member.relative_path,
            "path": member.path,
            "role": member.role,
            "project_id": member.project_id,
            "harnessed": member.harnessed,
            "status": "unreadable",
            "error": format!("Cannot read project directory {}: {err}", member.path),
        });
    }
    if !path_is_within(ws_root, path) {
        return json!({
            "name": member.name,
            "relative_path": member.relative_path,
            "path": member.path,
            "role": member.role,
            "project_id": member.project_id,
            "harnessed": member.harnessed,
            "status": "degraded",
            "error": format!("Member path {} is outside workspace root {}", member.path, ws_root.display()),
        });
    }

    let harness = probe_harness_project(path);
    if let (Some(expected), Some(actual)) = (&member.project_id, &harness.project_id) {
        if expected != actual {
            return json!({
                "name": member.name,
                "relative_path": member.relative_path,
                "path": member.path,
                "role": harness.role.or_else(|| member.role.clone()),
                "project_id": actual,
                "expected_project_id": expected,
                "harnessed": harness.harnessed,
                "status": "id_mismatch",
                "error": format!("Expected project_id '{expected}', found '{actual}' on disk."),
            });
        }
    }

    if !harness.harnessed {
        return json!({
            "name": member.name,
            "relative_path": member.relative_path,
            "path": member.path,
            "role": member.role,
            "project_id": member.project_id,
            "harnessed": false,
            "status": "ok",
            "index": "unharnessed",
            "error": Value::Null,
        });
    }

    let idx_path = index_json_path(path);
    let (index_state, index_err) = if !idx_path.is_file() {
        ("missing", None)
    } else {
        match fs::read_to_string(&idx_path) {
            Ok(raw) => match serde_json::from_str::<ProjectIndex>(&raw) {
                Ok(v) if checksum_valid(&v) => ("ok", None),
                Ok(_) => (
                    "corrupt",
                    Some(
                        "Derived index checksum mismatch; run `harness reindex` inside member."
                            .to_string(),
                    ),
                ),
                Err(e) => (
                    "corrupt",
                    Some(format!(
                        "Derived index JSON invalid ({e}); run `harness reindex` inside member."
                    )),
                ),
            },
            Err(e) => (
                "unreadable",
                Some(format!("Failed reading derived index: {e}")),
            ),
        }
    };

    let mut story_counts = BTreeMap::new();
    let mut open_reports = 0usize;
    let mut catalog_err: Option<String> = None;
    match build_catalog(path) {
        Ok(cat) => {
            for s in by_type(&cat, "story") {
                *story_counts.entry(s.status.clone()).or_insert(0usize) += 1;
            }
            open_reports = by_type(&cat, "report")
                .into_iter()
                .filter(|r| matches!(r.status.as_str(), "open" | "acked" | "needs_info"))
                .count();
        }
        Err(e) => {
            catalog_err = Some(format!("Catalog read error: {e}"));
        }
    }

    let final_err = catalog_err.or(index_err);
    let status = if final_err.is_some() {
        "degraded"
    } else {
        "ok"
    };

    json!({
        "name": member.name,
        "relative_path": member.relative_path,
        "path": member.path,
        "role": harness.role.or_else(|| member.role.clone()),
        "project_id": harness.project_id.or_else(|| member.project_id.clone()),
        "harnessed": true,
        "status": status,
        "index": index_state,
        "stories": story_counts,
        "open_reports": open_reports,
        "error": final_err,
    })
}

pub fn workspace_status(dir: &Path, workspace_sel: Option<&str>) -> Result<Value> {
    let store = read_workspace_store()?;
    let idx = resolve_workspace_index(&store, dir, workspace_sel)?;
    let ws = &store.workspaces[idx];
    let ws_root = Path::new(&ws.root_path);

    let mut members = Vec::with_capacity(ws.projects.len());
    let mut degraded = 0usize;
    for m in &ws.projects {
        let mh = probe_member_health(ws_root, m);
        if mh["status"] != "ok" {
            degraded += 1;
        }
        members.push(mh);
    }

    let pending_impacts = ws.impacts.iter().filter(|i| i.status == "pending").count();
    let pending_required = ws
        .impacts
        .iter()
        .filter(|i| i.status == "pending" && i.required)
        .count();

    Ok(json!({
        "workspace": {
            "id": ws.id,
            "name": ws.name,
            "root_path": ws.root_path,
            "policy": ws.policy,
        },
        "summary": {
            "members_total": ws.projects.len(),
            "members_degraded": degraded,
            "dependencies": ws.dependencies.len(),
            "impacts_total": ws.impacts.len(),
            "impacts_pending": pending_impacts,
            "impacts_pending_required": pending_required,
        },
        "members": members,
        "dependencies": ws.dependencies,
        "pending_impacts": ws.impacts.iter().filter(|i| i.status == "pending").collect::<Vec<_>>(),
    }))
}

fn entry_matches_task(entry: &CatalogEntry, task_query: &str) -> bool {
    let q = task_query.to_ascii_lowercase();
    if entry.id.to_ascii_lowercase().contains(&q)
        || entry.title.to_ascii_lowercase().contains(&q)
        || entry.status.to_ascii_lowercase().contains(&q)
    {
        return true;
    }
    as_string(&entry.data, "contract").is_some_and(|c| c.to_ascii_lowercase().contains(&q))
        || as_string_array(&entry.data, "links")
            .unwrap_or_default()
            .iter()
            .any(|l| l.to_ascii_lowercase().contains(&q))
}

fn summarize_catalog_for_context(
    catalog: &ProjectCatalog,
    task_filter: Option<&str>,
    limit: usize,
) -> (Vec<Value>, Vec<Value>, Vec<Value>) {
    let stories = by_type(catalog, "story");
    let mut ranked_stories: Vec<&CatalogEntry> = stories
        .into_iter()
        .filter(|s| {
            task_filter.is_none_or(|q| entry_matches_task(s, q))
                || matches!(s.status.as_str(), "in_progress" | "blocked" | "planned")
        })
        .collect();
    ranked_stories.sort_by_key(|s| match s.status.as_str() {
        "in_progress" => (0, s.id.as_str()),
        "blocked" => (1, s.id.as_str()),
        "planned" => (2, s.id.as_str()),
        _ => (3, s.id.as_str()),
    });
    if let Some(q) = task_filter {
        let filtered: Vec<&CatalogEntry> = ranked_stories
            .iter()
            .copied()
            .filter(|s| entry_matches_task(s, q))
            .collect();
        if !filtered.is_empty() {
            ranked_stories = filtered;
        }
    }
    let story_items: Vec<Value> = ranked_stories
        .into_iter()
        .take(limit)
        .map(|s| {
            json!({
                "id": s.id,
                "title": truncate_utf8_chars(&s.title, 120).0,
                "status": s.status,
                "contract": as_string(&s.data, "contract").map(|c| truncate_utf8_chars(&c, 120).0),
            })
        })
        .collect();

    let decisions = by_type(catalog, "decision");
    let decision_items: Vec<Value> = decisions
        .into_iter()
        .rev()
        .filter(|d| task_filter.is_none_or(|q| entry_matches_task(d, q)))
        .take(limit)
        .map(|d| {
            json!({
                "id": d.id,
                "title": truncate_utf8_chars(&d.title, 120).0,
                "status": d.status,
            })
        })
        .collect();

    let reports = by_type(catalog, "report");
    let report_items: Vec<Value> = reports
        .into_iter()
        .filter(|r| matches!(r.status.as_str(), "open" | "acked" | "needs_info"))
        .filter(|r| task_filter.is_none_or(|q| entry_matches_task(r, q)))
        .take(limit)
        .map(|r| {
            json!({
                "id": r.id,
                "summary": truncate_utf8_chars(&r.title, 120).0,
                "status": r.status,
            })
        })
        .collect();

    (story_items, decision_items, report_items)
}

/// Return bounded composite context across workspace members, resilient to
/// unreadable/missing/corrupt child projects and strictly within `opts.max_chars`.
pub fn workspace_context(
    dir: &Path,
    workspace_sel: Option<&str>,
    opts: &ContextOptions,
) -> Result<Value> {
    let store = read_workspace_store()?;
    let idx = resolve_workspace_index(&store, dir, workspace_sel)?;
    let ws = &store.workspaces[idx];
    let ws_root = Path::new(&ws.root_path);
    let max_chars = opts.max_chars.max(512);
    let limit = opts.limit.clamp(1, 20);

    let filtered_members: Vec<&WorkspaceMember> = ws
        .projects
        .iter()
        .filter(|m| {
            let proj_ok = opts.project.as_deref().is_none_or(|p| {
                m.name == p
                    || m.project_id.as_deref() == Some(p)
                    || m.relative_path == p.replace('\\', "/")
            });
            let role_ok = opts.role.as_deref().is_none_or(|r| {
                m.role
                    .as_deref()
                    .is_some_and(|mr| mr.eq_ignore_ascii_case(r.trim()))
            });
            proj_ok && role_ok
        })
        .collect();

    let mut project_contexts = Vec::new();
    let mut warnings = Vec::new();
    for member in &filtered_members {
        let health = probe_member_health(ws_root, member);
        if health["status"] != "ok" {
            if let Some(err) = health["error"].as_str() {
                warnings.push(format!("{}: {err}", member.name));
            }
        }
        let open_impacts: Vec<Value> = ws
            .impacts
            .iter()
            .filter(|i| {
                i.status == "pending"
                    && (i.source_member == member.name || i.target_member == member.name)
            })
            .take(limit)
            .map(|i| {
                json!({
                    "id": i.id,
                    "source": i.source_member,
                    "target": i.target_member,
                    "kind": i.kind,
                    "required": i.required,
                    "summary": truncate_utf8_chars(&i.summary, 120).0,
                    "source_ref": i.source_ref,
                })
            })
            .collect();

        let (stories, decisions, reports) = if member.harnessed && Path::new(&member.path).is_dir()
        {
            match build_catalog(Path::new(&member.path)) {
                Ok(cat) => summarize_catalog_for_context(&cat, opts.task.as_deref(), limit),
                Err(e) => {
                    warnings.push(format!("{}: failed reading catalog ({e})", member.name));
                    (Vec::new(), Vec::new(), Vec::new())
                }
            }
        } else {
            (Vec::new(), Vec::new(), Vec::new())
        };

        project_contexts.push(json!({
            "name": member.name,
            "relative_path": member.relative_path,
            "role": health["role"],
            "project_id": health["project_id"],
            "harnessed": health["harnessed"],
            "status": health["status"],
            "index": health["index"],
            "error": health["error"],
            "stories": stories,
            "decisions": decisions,
            "open_reports": reports,
            "open_impacts": open_impacts,
        }));
    }

    let selected_names: BTreeSet<&str> = filtered_members.iter().map(|m| m.name.as_str()).collect();
    let relevant_deps: Vec<&WorkspaceDependency> = ws
        .dependencies
        .iter()
        .filter(|d| {
            selected_names.is_empty()
                || selected_names.contains(d.from.as_str())
                || selected_names.contains(d.to.as_str())
        })
        .collect();

    let mut payload = json!({
        "workspace": {
            "id": ws.id,
            "name": ws.name,
            "root_path": ws.root_path,
            "policy": ws.policy,
        },
        "filters": {
            "task": opts.task,
            "project": opts.project,
            "role": opts.role,
            "limit": limit,
            "max_chars": max_chars,
        },
        "truncated": false,
        "warnings": warnings,
        "dependencies": relevant_deps,
        "projects": project_contexts,
    });

    // Enforce max_chars budget cleanly while keeping valid JSON structure.
    let mut rendered_len = serde_json::to_string(&payload)?.chars().count();
    if rendered_len > max_chars {
        payload["truncated"] = Value::Bool(true);
        let count = payload["projects"].as_array().map_or(0, Vec::len);
        for idx_proj in 0..count {
            if rendered_len <= max_chars {
                break;
            }
            if let Some(decisions) = payload["projects"][idx_proj]
                .get_mut("decisions")
                .and_then(Value::as_array_mut)
            {
                decisions.clear();
            }
            if let Some(reports) = payload["projects"][idx_proj]
                .get_mut("open_reports")
                .and_then(Value::as_array_mut)
            {
                reports.clear();
            }
            rendered_len = serde_json::to_string(&payload)?.chars().count();
        }
        for idx_proj in 0..count {
            if rendered_len <= max_chars {
                break;
            }
            if let Some(stories) = payload["projects"][idx_proj]
                .get_mut("stories")
                .and_then(Value::as_array_mut)
            {
                stories.truncate(1);
            }
            rendered_len = serde_json::to_string(&payload)?.chars().count();
        }
        if rendered_len > max_chars {
            for idx_proj in 0..count {
                if rendered_len <= max_chars {
                    break;
                }
                if let Some(stories) = payload["projects"][idx_proj]
                    .get_mut("stories")
                    .and_then(Value::as_array_mut)
                {
                    stories.clear();
                }
                rendered_len = serde_json::to_string(&payload)?.chars().count();
            }
        }
    }

    Ok(payload)
}

pub fn format_workspace_context_text(ctx: &Value, max_chars: usize) -> String {
    let mut out = String::new();
    let ws = &ctx["workspace"];
    out.push_str(&format!(
        "Workspace: {} ({}) [{}]\n",
        ws["name"].as_str().unwrap_or(""),
        ws["id"].as_str().unwrap_or(""),
        ws["root_path"].as_str().unwrap_or(""),
    ));
    out.push_str(&format!(
        "Policy: impact_gate={}, require_on_contract_story={}\n",
        ws["policy"]["impact_gate"].as_str().unwrap_or("required"),
        ws["policy"]["require_impact_on_contract_story"]
            .as_bool()
            .unwrap_or(true)
    ));
    if let Some(warnings) = ctx["warnings"].as_array() {
        for w in warnings {
            if let Some(msg) = w.as_str() {
                out.push_str(&format!("  [warn] {msg}\n"));
            }
        }
    }
    if let Some(projects) = ctx["projects"].as_array() {
        out.push_str(&format!("Projects ({}):\n", projects.len()));
        for p in projects {
            out.push_str(&format!(
                "  - {} [{}] role={} status={} harnessed={}\n",
                p["name"].as_str().unwrap_or(""),
                p["relative_path"].as_str().unwrap_or(""),
                p["role"].as_str().unwrap_or("-"),
                p["status"].as_str().unwrap_or("unknown"),
                p["harnessed"].as_bool().unwrap_or(false),
            ));
            if let Some(err) = p["error"].as_str() {
                out.push_str(&format!("      error: {err}\n"));
            }
            if let Some(stories) = p["stories"].as_array() {
                for s in stories {
                    out.push_str(&format!(
                        "      story {} [{}]: {}\n",
                        s["id"].as_str().unwrap_or(""),
                        s["status"].as_str().unwrap_or(""),
                        s["title"].as_str().unwrap_or(""),
                    ));
                }
            }
            if let Some(impacts) = p["open_impacts"].as_array() {
                for imp in impacts {
                    out.push_str(&format!(
                        "      impact {} ({} -> {}, {}): {}\n",
                        imp["id"].as_str().unwrap_or(""),
                        imp["source"].as_str().unwrap_or(""),
                        imp["target"].as_str().unwrap_or(""),
                        imp["kind"].as_str().unwrap_or(""),
                        imp["summary"].as_str().unwrap_or(""),
                    ));
                }
            }
        }
    }
    truncate_utf8_chars(&out, max_chars).0
}

fn find_member_for_dir<'a>(ws: &'a WorkspaceEntry, dir: &Path) -> Option<&'a WorkspaceMember> {
    let canon = canonicalize_clean(dir).unwrap_or_else(|_| clean_path(dir));
    ws.projects.iter().find(|m| {
        let mp = Path::new(&m.path);
        workspace_paths_equal(mp, &canon) || path_is_within(mp, &canon)
    })
}

/// Detect downstream impacts using declared dependencies, source story `contract`
/// metadata, and git diff/uncommitted changes, plus advisory diff hints.
pub fn impact_check(
    dir: &Path,
    workspace_sel: Option<&str>,
    opts: &ImpactCheckOptions,
) -> Result<Value> {
    let mut store = read_workspace_store()?;
    let idx = resolve_workspace_index(&store, dir, workspace_sel)?;
    let ws_snapshot = store.workspaces[idx].clone();

    let source_members: Vec<WorkspaceMember> = if let Some(sel) = &opts.source {
        vec![resolve_member(&ws_snapshot, sel)?.clone()]
    } else if let Some(inferred) = find_member_for_dir(&ws_snapshot, dir) {
        vec![inferred.clone()]
    } else {
        let sources: BTreeSet<&str> = ws_snapshot
            .dependencies
            .iter()
            .map(|d| d.from.as_str())
            .collect();
        ws_snapshot
            .projects
            .iter()
            .filter(|m| sources.contains(m.name.as_str()))
            .cloned()
            .collect()
    };

    if source_members.is_empty() {
        return Ok(json!({
            "workspace_id": ws_snapshot.id,
            "workspace_name": ws_snapshot.name,
            "sources": [],
            "obligations": [],
            "advisory_suggestions": [],
            "warnings": ["No source projects with outbound dependencies found."],
        }));
    }

    let mut per_source = Vec::new();
    let mut created_or_matched = Vec::new();
    let mut advisory_all = Vec::new();
    let mut warnings = Vec::new();
    let mut emitted_reports = Vec::new();
    let now = now_iso();

    for source in &source_members {
        let source_path = Path::new(&source.path);
        let story_contract = if let Some(story_id) = &opts.story {
            if source.harnessed && source_path.is_dir() {
                match get_entity(source_path, story_id)? {
                    Some(ent) => as_string(&ent.data, "contract"),
                    None => {
                        warnings.push(format!(
                            "Story '{story_id}' not found in source member '{}'",
                            source.name
                        ));
                        None
                    }
                }
            } else {
                None
            }
        } else {
            None
        };

        let changed_files = match git_changed_files(
            source_path,
            opts.since.as_deref(),
            opts.include_uncommitted || opts.since.is_none(),
        ) {
            Ok(files) => files,
            Err(err) => {
                warnings.push(format!("{}: {err}", source.name));
                Vec::new()
            }
        };

        let advisory = suggest_contract_like_files(&changed_files);
        let outbound: Vec<WorkspaceDependency> = ws_snapshot
            .dependencies
            .iter()
            .filter(|d| d.from == source.name)
            .cloned()
            .collect();

        if outbound.is_empty() && !advisory.is_empty() {
            advisory_all.push(json!({
                "source_member": source.name,
                "files": advisory,
                "hint": "Contract-like files changed, but no outbound workspace dependency is declared from this member.",
            }));
        } else if !advisory.is_empty() {
            let unmapped: Vec<String> = advisory
                .into_iter()
                .filter(|f| {
                    outbound.iter().all(|d| {
                        match_contract_paths(std::slice::from_ref(f), &d.contract_paths).is_empty()
                    })
                })
                .collect();
            if !unmapped.is_empty() {
                advisory_all.push(json!({
                    "source_member": source.name,
                    "files": unmapped,
                    "hint": "Contract-like files changed outside declared contract_paths.",
                }));
            }
        }

        for dep in &outbound {
            let matched_paths = match_contract_paths(&changed_files, &dep.contract_paths);
            let has_contract_story = opts.story.is_some()
                && story_contract
                    .as_deref()
                    .is_some_and(|c| !c.trim().is_empty());

            // Determine whether this dependency is triggered, ruled out cleanly by diff, or skipped.
            let (triggered, initial_status, auto_reason) = if !dep.contract_paths.is_empty() {
                if !matched_paths.is_empty() {
                    (true, "pending", None)
                } else if has_contract_story && !changed_files.is_empty() {
                    // Explicit contract story run: changed files exist and none matched declared contract_paths.
                    (
                        true,
                        "no_change_needed",
                        Some(format!(
                            "Changed files did not match declared contract_paths ({})",
                            dep.contract_paths.join(", ")
                        )),
                    )
                } else if has_contract_story && changed_files.is_empty() {
                    (true, "pending", None)
                } else {
                    (false, "", None)
                }
            } else if opts.story.is_some() || !changed_files.is_empty() {
                (true, "pending", None)
            } else {
                (false, "", None)
            };

            if !triggered {
                continue;
            }

            let target_member = resolve_member(&ws_snapshot, &dep.to).ok().cloned();
            let summary = if let Some(c) = &story_contract {
                format!(
                    "{} ({}) change in {} impacts {}: {}",
                    dep.kind,
                    opts.story.as_deref().unwrap_or("workspace"),
                    source.name,
                    dep.to,
                    c
                )
            } else if !matched_paths.is_empty() {
                format!(
                    "{} files changed in {} ({}): review {}",
                    dep.kind,
                    source.name,
                    matched_paths.join(", "),
                    dep.to
                )
            } else {
                format!(
                    "{} change in {} may impact {}",
                    dep.kind, source.name, dep.to
                )
            };

            if opts.create {
                let ws_mut = &mut store.workspaces[idx];
                if let Some(existing_imp) = ws_mut.impacts.iter_mut().find(|i| {
                    i.source_member == source.name
                        && i.target_member == dep.to
                        && i.dependency_id.as_deref() == Some(dep.id.as_str())
                        && i.source_ref == opts.story
                }) {
                    if !matched_paths.is_empty() {
                        existing_imp.matched_paths = matched_paths.clone();
                    }
                    existing_imp.updated_at = now.clone();
                    created_or_matched.push(json!({
                        "action": "existing",
                        "impact": existing_imp.clone(),
                    }));
                } else {
                    let imp_id =
                        next_prefixed_id(ws_mut.impacts.iter().map(|i| i.id.clone()), "IMP-");
                    let imp = WorkspaceImpact {
                        id: imp_id,
                        source_member: source.name.clone(),
                        source_project_id: source.project_id.clone(),
                        source_ref: opts.story.clone(),
                        target_member: dep.to.clone(),
                        target_project_id: target_member
                            .as_ref()
                            .and_then(|t| t.project_id.clone()),
                        dependency_id: Some(dep.id.clone()),
                        kind: dep.kind.clone(),
                        required: dep.required,
                        status: initial_status.to_string(),
                        summary,
                        matched_paths: matched_paths.clone(),
                        reason: auto_reason,
                        note: None,
                        target_story: None,
                        report_id: None,
                        created_at: now.clone(),
                        updated_at: now.clone(),
                    };
                    ws_mut.impacts.push(imp.clone());
                    created_or_matched.push(json!({
                        "action": "created",
                        "impact": imp,
                    }));
                }
            } else {
                created_or_matched.push(json!({
                    "action": "preview",
                    "dependency_id": dep.id,
                    "source_member": source.name,
                    "target_member": dep.to,
                    "kind": dep.kind,
                    "required": dep.required,
                    "proposed_status": initial_status,
                    "matched_paths": matched_paths,
                    "summary": summary,
                }));
            }
        }

        per_source.push(json!({
            "member": source.name,
            "changed_files": changed_files,
            "story_contract": story_contract,
        }));
    }

    if opts.create && opts.emit_reports {
        let ws_mut = &mut store.workspaces[idx];
        for imp in &mut ws_mut.impacts {
            if imp.status != "pending" || imp.report_id.is_some() {
                continue;
            }
            if let Some(target_m) = ws_mut.projects.iter().find(|m| m.name == imp.target_member) {
                if !target_m.harnessed {
                    warnings.push(format!(
                        "Target '{}' is unharnessed; skipped emitting report for {}",
                        target_m.name, imp.id
                    ));
                    continue;
                }
                let target_path = Path::new(&target_m.path);
                if !target_path.is_dir() {
                    warnings.push(format!(
                        "Target '{}' path missing ({}); skipped report for {}",
                        target_m.name, target_m.path, imp.id
                    ));
                    continue;
                }
                if let Err(err) = ensure_peer_write_allowed(target_path) {
                    warnings.push(format!("Report blocked for {}: {err}", target_m.name));
                    continue;
                }
                let sev = if imp.required { "high" } else { "medium" };
                let (_, rp_id) = add_report(
                    target_path,
                    &imp.summary,
                    Some(sev),
                    imp.source_project_id
                        .as_deref()
                        .or(Some(&imp.source_member)),
                    imp.source_ref.as_deref(),
                )?;
                imp.report_id = Some(rp_id.clone());
                imp.updated_at = now.clone();
                emitted_reports.push(json!({
                    "impact_id": imp.id,
                    "target_member": target_m.name,
                    "report_id": rp_id,
                }));
            }
        }
    }

    if opts.create {
        store.workspaces[idx].updated_at = now;
        write_workspace_store(&store)?;
    }

    Ok(json!({
        "workspace_id": store.workspaces[idx].id,
        "workspace_name": store.workspaces[idx].name,
        "created": opts.create,
        "sources": per_source,
        "obligations": created_or_matched,
        "emitted_reports": emitted_reports,
        "advisory_suggestions": advisory_all,
        "warnings": warnings,
    }))
}

#[allow(clippy::too_many_arguments)]
pub fn add_impact(
    dir: &Path,
    workspace_sel: Option<&str>,
    source_sel: &str,
    target_sel: &str,
    summary: &str,
    kind: &str,
    required: bool,
    source_ref: Option<&str>,
    dep_id: Option<&str>,
) -> Result<WorkspaceImpact> {
    if summary.trim().is_empty() {
        return Err(Error::new("Impact summary must not be empty"));
    }
    let mut store = read_workspace_store()?;
    let idx = resolve_workspace_index(&store, dir, workspace_sel)?;
    let ws = &mut store.workspaces[idx];
    let source = resolve_member(ws, source_sel)?.clone();
    let target = resolve_member(ws, target_sel)?.clone();
    if source.name == target.name {
        return Err(Error::new(
            "Impact source and target cannot be the same member",
        ));
    }
    let kind = validate_dep_kind(kind)?;
    let now = now_iso();
    let id = next_prefixed_id(ws.impacts.iter().map(|i| i.id.clone()), "IMP-");
    let impact = WorkspaceImpact {
        id,
        source_member: source.name,
        source_project_id: source.project_id,
        source_ref: source_ref.map(str::to_string),
        target_member: target.name,
        target_project_id: target.project_id,
        dependency_id: dep_id.map(str::to_string),
        kind,
        required,
        status: "pending".to_string(),
        summary: summary.trim().to_string(),
        matched_paths: Vec::new(),
        reason: None,
        note: None,
        target_story: None,
        report_id: None,
        created_at: now.clone(),
        updated_at: now,
    };
    ws.impacts.push(impact.clone());
    ws.updated_at = now_iso();
    write_workspace_store(&store)?;
    Ok(impact)
}

pub fn list_impacts(
    dir: &Path,
    workspace_sel: Option<&str>,
    status: Option<&str>,
    source: Option<&str>,
    target: Option<&str>,
    story: Option<&str>,
) -> Result<Vec<WorkspaceImpact>> {
    let store = read_workspace_store()?;
    let idx = resolve_workspace_index(&store, dir, workspace_sel)?;
    let ws = &store.workspaces[idx];
    let status_norm = match status {
        Some(s) => Some(validate_impact_status(s)?),
        None => None,
    };
    Ok(ws
        .impacts
        .iter()
        .filter(|i| status_norm.as_deref().is_none_or(|s| i.status == s))
        .filter(|i| source.is_none_or(|src| i.source_member == src))
        .filter(|i| target.is_none_or(|dst| i.target_member == dst))
        .filter(|i| story.is_none_or(|st| i.source_ref.as_deref() == Some(st)))
        .cloned()
        .collect())
}

pub fn update_impact(
    dir: &Path,
    workspace_sel: Option<&str>,
    impact_id: &str,
    status: &str,
    reason: Option<&str>,
    note: Option<&str>,
    target_story: Option<&str>,
) -> Result<WorkspaceImpact> {
    let status = validate_impact_status(status)?;
    validate_impact_disposition(&status, reason, note, target_story)?;

    let mut store = read_workspace_store()?;
    let idx = resolve_workspace_index(&store, dir, workspace_sel)?;
    let ws = &mut store.workspaces[idx];
    let imp = ws
        .impacts
        .iter_mut()
        .find(|i| i.id == impact_id)
        .ok_or_else(|| {
            Error::with_code(
                "HARNESS_E_NOT_FOUND",
                format!("Impact '{impact_id}' not found"),
            )
        })?;
    imp.status = status;
    if let Some(r) = reason {
        imp.reason = Some(r.trim().to_string());
    }
    if let Some(n) = note {
        imp.note = Some(n.trim().to_string());
    }
    if let Some(ts) = target_story {
        imp.target_story = Some(ts.trim().to_string());
    }
    imp.updated_at = now_iso();
    let updated = imp.clone();
    ws.updated_at = now_iso();
    write_workspace_store(&store)?;
    Ok(updated)
}

/// Gate story completion when the story's project belongs to a workspace with unresolved
/// required cross-project obligations or unassessed contract dependencies.
pub fn check_story_impact_gate(
    project_root: &Path,
    story_id: &str,
    contract: Option<&str>,
) -> Result<()> {
    let store = read_workspace_store()?;
    if store.workspaces.is_empty() {
        return Ok(());
    }
    let canon_proj = canonicalize_clean(project_root).unwrap_or_else(|_| clean_path(project_root));
    let proj_probe = probe_harness_project(&canon_proj);

    for ws in &store.workspaces {
        if ws.policy.impact_gate == "off" {
            continue;
        }
        let Some(member) = ws.projects.iter().find(|m| {
            workspace_paths_equal(Path::new(&m.path), &canon_proj)
                || (proj_probe.project_id.is_some() && m.project_id == proj_probe.project_id)
        }) else {
            continue;
        };

        let blocking: Vec<&WorkspaceImpact> = ws
            .impacts
            .iter()
            .filter(|i| {
                i.source_member == member.name
                    && i.required
                    && i.status == "pending"
                    && (i.source_ref.as_deref() == Some(story_id) || i.source_ref.is_none())
            })
            .collect();

        if !blocking.is_empty() {
            let summary: Vec<String> = blocking
                .iter()
                .map(|i| format!("{} -> {} ({})", i.id, i.target_member, i.kind))
                .collect();
            let msg = format!(
                "Workspace '{}' impact gate: story {story_id} in '{}' has pending required downstream obligation(s): {}. Resolve with `harness workspace impact update <id> --status updated --note \"...\"` or `--status no_change_needed|waived --reason \"...\"`.",
                ws.name,
                member.name,
                summary.join(", ")
            );
            if ws.policy.impact_gate == "required" {
                return Err(Error::with_code("HARNESS_E_IMPACT_GATE", msg));
            }
            eprintln!("warning: {msg}");
        }

        let has_contract = contract.is_some_and(|c| !c.trim().is_empty());
        if has_contract && ws.policy.require_impact_on_contract_story {
            let required_deps: Vec<&WorkspaceDependency> = ws
                .dependencies
                .iter()
                .filter(|d| d.from == member.name && d.required)
                .collect();
            let unassessed: Vec<&WorkspaceDependency> = required_deps
                .into_iter()
                .filter(|dep| {
                    !ws.impacts.iter().any(|i| {
                        i.source_member == member.name
                            && i.source_ref.as_deref() == Some(story_id)
                            && (i.dependency_id.as_deref() == Some(dep.id.as_str())
                                || i.target_member == dep.to)
                    })
                })
                .collect();
            if !unassessed.is_empty() {
                let targets: Vec<&str> = unassessed.iter().map(|d| d.to.as_str()).collect();
                let msg = format!(
                    "Workspace '{}' impact gate: story {story_id} declares a contract change in '{}' and has required downstream dependencies ({}), but no workspace impact assessment is recorded for {story_id}. Run `harness workspace impact check --source {} --story {story_id} --create` first.",
                    ws.name,
                    member.name,
                    targets.join(", "),
                    member.name
                );
                if ws.policy.impact_gate == "required" {
                    return Err(Error::with_code("HARNESS_E_IMPACT_GATE", msg));
                }
                eprintln!("warning: {msg}");
            }
        }
    }
    Ok(())
}

/// Explicit read-only impact gate report for a workspace story/project.
pub fn gate_report(
    dir: &Path,
    workspace_sel: Option<&str>,
    source_sel: Option<&str>,
    story_id: &str,
) -> Result<Value> {
    let store = read_workspace_store()?;
    let idx = resolve_workspace_index(&store, dir, workspace_sel)?;
    let ws = &store.workspaces[idx];
    let member = if let Some(sel) = source_sel {
        resolve_member(ws, sel)?
    } else if let Some(m) = find_member_for_dir(ws, dir) {
        m
    } else {
        return Err(Error::new(
            "workspace impact gate requires --source <member> when run outside a member project",
        ));
    };

    let member_path = Path::new(&member.path);
    let contract = if member.harnessed && member_path.is_dir() {
        get_entity(member_path, story_id)?.and_then(|e| as_string(&e.data, "contract"))
    } else {
        None
    };

    match check_story_impact_gate(member_path, story_id, contract.as_deref()) {
        Ok(()) => Ok(json!({
            "passed": true,
            "workspace_id": ws.id,
            "member": member.name,
            "story": story_id,
            "policy": ws.policy,
        })),
        Err(err) => Ok(json!({
            "passed": false,
            "workspace_id": ws.id,
            "member": member.name,
            "story": story_id,
            "policy": ws.policy,
            "reason": err.message,
        })),
    }
}

/// Expose whether a project belongs to any workspace and return those workspace entries (used by MCP/dashboard).
pub fn workspaces_for_project(project_root: &Path) -> Result<Vec<WorkspaceEntry>> {
    let store = read_workspace_store()?;
    let canon = canonicalize_clean(project_root).unwrap_or_else(|_| clean_path(project_root));
    let pid = probe_harness_project(&canon).project_id;
    Ok(store
        .workspaces
        .into_iter()
        .filter(|ws| {
            workspace_paths_equal(Path::new(&ws.root_path), &canon)
                || ws.projects.iter().any(|m| {
                    workspace_paths_equal(Path::new(&m.path), &canon)
                        || (pid.is_some() && m.project_id == pid)
                })
        })
        .collect())
}

pub fn lookup_workspace(dir: &Path, selector: Option<&str>) -> Result<WorkspaceEntry> {
    let store = read_workspace_store()?;
    let idx = resolve_workspace_index(&store, dir, selector)?;
    Ok(store.workspaces[idx].clone())
}
