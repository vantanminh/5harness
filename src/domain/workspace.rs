use std::collections::{BTreeSet, VecDeque};
use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

pub const WORKSPACE_STORE_VERSION: u32 = 1;
pub const WORKSPACE_MANIFEST_VERSION: u32 = 1;
pub const DEFAULT_DISCOVERY_DEPTH: usize = 2;
pub const MAX_DISCOVERY_DEPTH: usize = 5;
pub const MAX_DISCOVERY_DIRS: usize = 500;

pub const VALID_IMPACT_STATUSES: &[&str] = &["pending", "updated", "no_change_needed", "waived"];
pub const VALID_IMPACT_GATES: &[&str] = &["required", "advisory", "off"];
pub const VALID_DEP_KINDS: &[&str] = &[
    "api_contract",
    "shared_schema",
    "sdk",
    "event",
    "build",
    "custom",
];

pub const EXCLUDED_DISCOVERY_DIRS: &[&str] = &[
    ".git",
    ".5harness",
    ".5harness-backup",
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    ".next",
    ".nuxt",
    ".svelte-kit",
    "vendor",
    ".venv",
    "venv",
    "__pycache__",
    ".cache",
    ".turbo",
    ".parcel-cache",
    ".gradle",
    "pods",
    "deriveddata",
    "coverage",
    "tmp",
    ".tmp",
    "bin",
    "obj",
];

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspaceStore {
    pub version: u32,
    #[serde(default)]
    pub workspaces: Vec<WorkspaceEntry>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspacePolicy {
    #[serde(default = "default_impact_gate")]
    pub impact_gate: String,
    #[serde(default = "default_true")]
    pub require_impact_on_contract_story: bool,
}

fn default_impact_gate() -> String {
    "required".to_string()
}

fn default_true() -> bool {
    true
}

impl Default for WorkspacePolicy {
    fn default() -> Self {
        Self {
            impact_gate: default_impact_gate(),
            require_impact_on_contract_story: true,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspaceMember {
    pub name: String,
    pub path: String,
    pub relative_path: String,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
    #[serde(default)]
    pub harnessed: bool,
    #[serde(default)]
    pub git_common_dir: Option<String>,
    pub added_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspaceDependency {
    pub id: String,
    pub from: String,
    pub to: String,
    pub kind: String,
    #[serde(default = "default_true")]
    pub required: bool,
    #[serde(default)]
    pub contract_paths: Vec<String>,
    #[serde(default)]
    pub notes: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspaceImpact {
    pub id: String,
    pub source_member: String,
    #[serde(default)]
    pub source_project_id: Option<String>,
    #[serde(default)]
    pub source_ref: Option<String>,
    pub target_member: String,
    #[serde(default)]
    pub target_project_id: Option<String>,
    #[serde(default)]
    pub dependency_id: Option<String>,
    pub kind: String,
    #[serde(default = "default_true")]
    pub required: bool,
    pub status: String,
    pub summary: String,
    #[serde(default)]
    pub matched_paths: Vec<String>,
    #[serde(default)]
    pub reason: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub target_story: Option<String>,
    #[serde(default)]
    pub report_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspaceEntry {
    pub id: String,
    pub name: String,
    pub root_path: String,
    #[serde(default)]
    pub policy: WorkspacePolicy,
    #[serde(default)]
    pub projects: Vec<WorkspaceMember>,
    #[serde(default)]
    pub dependencies: Vec<WorkspaceDependency>,
    #[serde(default)]
    pub impacts: Vec<WorkspaceImpact>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct WorkspaceManifest {
    pub version: u32,
    pub name: String,
    #[serde(default)]
    pub policy: WorkspacePolicy,
    #[serde(default)]
    pub members: Vec<ManifestMember>,
    #[serde(default)]
    pub dependencies: Vec<ManifestDependency>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ManifestMember {
    pub name: String,
    pub relative_path: String,
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub role: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct ManifestDependency {
    pub from: String,
    pub to: String,
    pub kind: String,
    #[serde(default = "default_true")]
    pub required: bool,
    #[serde(default)]
    pub contract_paths: Vec<String>,
    #[serde(default)]
    pub notes: Option<String>,
}

pub fn empty_workspace_store() -> WorkspaceStore {
    WorkspaceStore {
        version: WORKSPACE_STORE_VERSION,
        workspaces: Vec::new(),
    }
}

/// Normalize a path for cross-platform storage and comparison without
/// retaining Windows extended-length `\\?\` prefixes.
pub fn clean_path(path: &Path) -> PathBuf {
    let raw = path.to_string_lossy();
    #[cfg(windows)]
    let cleaned = if let Some(rest) = raw.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = raw.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        raw.into_owned()
    };
    #[cfg(not(windows))]
    let cleaned = raw.into_owned();

    let mut out = PathBuf::new();
    for component in Path::new(&cleaned).components() {
        match component {
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    #[cfg(windows)]
    {
        let s = out.to_string_lossy();
        if s.len() >= 2 && s.as_bytes()[1] == b':' {
            let mut chars: Vec<char> = s.chars().collect();
            chars[0] = chars[0].to_ascii_uppercase();
            return PathBuf::from(chars.into_iter().collect::<String>());
        }
    }
    out
}

pub fn workspace_paths_equal(a: &Path, b: &Path) -> bool {
    let na = clean_path(a);
    let nb = clean_path(b);
    #[cfg(windows)]
    {
        na.to_string_lossy()
            .eq_ignore_ascii_case(&nb.to_string_lossy())
    }
    #[cfg(not(windows))]
    {
        na == nb
    }
}

/// Check whether `child` is contained within `root`, respecting platform
/// case sensitivity (case-insensitive on Windows).
pub fn path_is_within(root: &Path, child: &Path) -> bool {
    let nr = clean_path(root);
    let nc = clean_path(child);
    let r_comps: Vec<_> = nr.components().collect();
    let c_comps: Vec<_> = nc.components().collect();
    if c_comps.len() < r_comps.len() {
        return false;
    }
    r_comps
        .iter()
        .zip(c_comps.iter())
        .all(|(rc, cc)| component_eq(rc, cc))
}

fn component_eq(a: &Component<'_>, b: &Component<'_>) -> bool {
    #[cfg(windows)]
    {
        a.as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case(&b.as_os_str().to_string_lossy())
    }
    #[cfg(not(windows))]
    {
        a == b
    }
}

pub fn compute_relative_path(root: &Path, child: &Path) -> Result<String> {
    let nr = clean_path(root);
    let nc = clean_path(child);
    if !path_is_within(&nr, &nc) {
        return Err(Error::new(format!(
            "Path {} escapes workspace root {}",
            nc.display(),
            nr.display()
        )));
    }
    let root_len = nr.components().count();
    let parts: Vec<String> = nc
        .components()
        .skip(root_len)
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect();
    if parts.is_empty() {
        Ok(".".to_string())
    } else {
        Ok(parts.join("/"))
    }
}

pub fn is_excluded_dir_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.starts_with('.') || EXCLUDED_DISCOVERY_DIRS.iter().any(|d| *d == lower)
}

/// Strictly parse and validate the workspace store. Never silently discard
/// corrupt or newer-version workspace state.
pub fn parse_workspace_store_strict(raw: &str) -> Result<WorkspaceStore> {
    let store: WorkspaceStore = serde_json::from_str(raw).map_err(|err| {
        Error::with_code(
            "HARNESS_E_STATE",
            format!(
                "Workspace store is invalid JSON ({err}). Run `harness workspace doctor --repair` to back up and recover it."
            ),
        )
    })?;
    if store.version == 0 || store.version > WORKSPACE_STORE_VERSION {
        return Err(Error::with_code(
            "HARNESS_E_STATE",
            format!(
                "Unsupported workspace store version {} (supported: {}). Upgrade 5harness or run `harness workspace doctor --repair` after backing up.",
                store.version, WORKSPACE_STORE_VERSION
            ),
        ));
    }
    for ws in &store.workspaces {
        if ws.id.trim().is_empty() || ws.root_path.trim().is_empty() {
            return Err(Error::with_code(
                "HARNESS_E_STATE",
                "Workspace store contains an entry with empty id or root_path. Run `harness workspace doctor --repair`.",
            ));
        }
        if !VALID_IMPACT_GATES.contains(&ws.policy.impact_gate.as_str()) {
            return Err(Error::with_code(
                "HARNESS_E_STATE",
                format!(
                    "Workspace '{}' has invalid impact_gate '{}'.",
                    ws.name, ws.policy.impact_gate
                ),
            ));
        }
    }
    Ok(store)
}

pub fn parse_workspace_manifest_strict(raw: &str) -> Result<WorkspaceManifest> {
    let manifest: WorkspaceManifest = serde_json::from_str(raw).map_err(|err| {
        Error::with_code(
            "HARNESS_E_STATE",
            format!("Workspace manifest is invalid JSON: {err}"),
        )
    })?;
    if manifest.version == 0 || manifest.version > WORKSPACE_MANIFEST_VERSION {
        return Err(Error::with_code(
            "HARNESS_E_STATE",
            format!(
                "Unsupported workspace manifest version {} (supported: {}).",
                manifest.version, WORKSPACE_MANIFEST_VERSION
            ),
        ));
    }
    validate_impact_gate(&manifest.policy.impact_gate)?;
    for member in &manifest.members {
        if member.name.trim().is_empty() {
            return Err(Error::new("Manifest member name must not be empty"));
        }
        let rel = member.relative_path.replace('\\', "/");
        if rel.trim().is_empty()
            || rel.starts_with('/')
            || rel.starts_with('~')
            || rel.split('/').next().is_some_and(|p| p.contains(':'))
            || Path::new(&rel).components().any(|c| {
                matches!(
                    c,
                    Component::ParentDir | Component::RootDir | Component::Prefix(_)
                )
            })
        {
            return Err(Error::with_code(
                "HARNESS_E_PATH",
                format!(
                    "Manifest member '{}' has unsafe relative_path '{}'",
                    member.name, member.relative_path
                ),
            ));
        }
    }
    Ok(manifest)
}

pub fn validate_impact_gate(raw: &str) -> Result<String> {
    let normalized = raw.trim().to_ascii_lowercase();
    if VALID_IMPACT_GATES.contains(&normalized.as_str()) {
        Ok(normalized)
    } else {
        Err(Error::new(format!(
            "Invalid workspace impact gate \"{raw}\". Use {}",
            VALID_IMPACT_GATES.join(" | ")
        )))
    }
}

pub fn validate_dep_kind(raw: &str) -> Result<String> {
    let normalized = raw.trim().to_ascii_lowercase().replace('-', "_");
    if VALID_DEP_KINDS.contains(&normalized.as_str()) {
        Ok(normalized)
    } else {
        Err(Error::new(format!(
            "Invalid dependency kind \"{raw}\". Use {}",
            VALID_DEP_KINDS.join(" | ")
        )))
    }
}

pub fn validate_impact_status(raw: &str) -> Result<String> {
    let normalized = raw.trim().to_ascii_lowercase().replace('-', "_");
    if VALID_IMPACT_STATUSES.contains(&normalized.as_str()) {
        Ok(normalized)
    } else {
        Err(Error::new(format!(
            "Invalid impact status \"{raw}\". Use {}",
            VALID_IMPACT_STATUSES.join(" | ")
        )))
    }
}

pub fn validate_impact_disposition(
    status: &str,
    reason: Option<&str>,
    note: Option<&str>,
    target_story: Option<&str>,
) -> Result<()> {
    let has_reason = reason.is_some_and(|s| !s.trim().is_empty());
    let has_note = note.is_some_and(|s| !s.trim().is_empty());
    let has_target_story = target_story.is_some_and(|s| !s.trim().is_empty());
    match status {
        "no_change_needed" | "waived" if !has_reason => Err(Error::new(format!(
            "Impact status '{status}' requires a non-empty --reason"
        ))),
        "updated" if !has_reason && !has_note && !has_target_story => Err(Error::new(
            "Impact status 'updated' requires --note, --target-story, or --reason",
        )),
        _ => Ok(()),
    }
}

pub fn resolve_member<'a>(ws: &'a WorkspaceEntry, selector: &str) -> Result<&'a WorkspaceMember> {
    let trimmed = selector.trim();
    if trimmed.is_empty() {
        return Err(Error::new("Workspace member selector must not be empty"));
    }
    let rel_norm = trimmed.replace('\\', "/");
    let matches: Vec<&WorkspaceMember> = ws
        .projects
        .iter()
        .filter(|m| {
            m.name == trimmed
                || m.project_id.as_deref() == Some(trimmed)
                || m.relative_path == rel_norm
                || workspace_paths_equal(Path::new(&m.path), Path::new(trimmed))
        })
        .collect();
    match matches.len() {
        0 => Err(Error::new(format!(
            "Workspace member not found: '{selector}'"
        ))),
        1 => Ok(matches[0]),
        _ => Err(Error::new(format!(
            "Workspace member selector '{selector}' is ambiguous; use project_id or relative_path"
        ))),
    }
}

pub fn would_create_dep_cycle(deps: &[WorkspaceDependency], from: &str, to: &str) -> bool {
    if from == to {
        return true;
    }
    let mut visited = BTreeSet::new();
    let mut queue = VecDeque::new();
    queue.push_back(to.to_string());
    while let Some(curr) = queue.pop_front() {
        if curr == from {
            return true;
        }
        if !visited.insert(curr.clone()) {
            continue;
        }
        for dep in deps {
            if dep.from == curr {
                queue.push_back(dep.to.clone());
            }
        }
    }
    false
}

pub fn next_prefixed_id(existing: impl Iterator<Item = String>, prefix: &str) -> String {
    let mut max_n = 0u64;
    for id in existing {
        if let Some(rest) = id.strip_prefix(prefix) {
            if let Ok(n) = rest.parse::<u64>() {
                max_n = max_n.max(n);
            }
        }
    }
    format!("{prefix}{:03}", max_n + 1)
}

pub fn allocate_unique_member_name(
    existing: &[String],
    base_name: &str,
    relative_path: &str,
) -> String {
    let candidate = if base_name.trim().is_empty() {
        "project"
    } else {
        base_name.trim()
    };
    if !existing.iter().any(|n| n == candidate) {
        return candidate.to_string();
    }
    let rel = relative_path.replace('\\', "/");
    if !existing.iter().any(|n| n == &rel) {
        return rel;
    }
    let mut idx = 2usize;
    loop {
        let numbered = format!("{candidate}-{idx}");
        if !existing.iter().any(|n| n == &numbered) {
            return numbered;
        }
        idx += 1;
    }
}

pub fn match_contract_paths(changed_files: &[String], contract_paths: &[String]) -> Vec<String> {
    if contract_paths.is_empty() {
        return Vec::new();
    }
    let mut matched = Vec::new();
    for file in changed_files {
        let norm_file = file.replace('\\', "/");
        for pat in contract_paths {
            let norm_pat = pat
                .trim()
                .replace('\\', "/")
                .trim_start_matches("./")
                .to_string();
            if norm_pat.is_empty() {
                continue;
            }
            let pat_prefix = norm_pat.trim_end_matches('/');
            if norm_file == pat_prefix
                || norm_file.starts_with(&format!("{pat_prefix}/"))
                || (norm_pat.contains('*') && glob_match(&norm_pat, &norm_file))
            {
                matched.push(norm_file.clone());
                break;
            }
        }
    }
    matched.sort();
    matched.dedup();
    matched
}

fn glob_match(pattern: &str, text: &str) -> bool {
    let p_parts: Vec<&str> = pattern.split('*').collect();
    if p_parts.len() == 1 {
        return pattern == text;
    }
    let mut pos = 0usize;
    for (i, part) in p_parts.iter().enumerate() {
        if part.is_empty() {
            continue;
        }
        if i == 0 {
            if !text.starts_with(part) {
                return false;
            }
            pos = part.len();
        } else if i == p_parts.len() - 1 {
            return text[pos..].ends_with(part);
        } else if let Some(found) = text[pos..].find(part) {
            pos += found + part.len();
        } else {
            return false;
        }
    }
    true
}

pub fn suggest_contract_like_files(changed_files: &[String]) -> Vec<String> {
    const MARKERS: &[&str] = &[
        "openapi",
        "swagger",
        "schema",
        ".proto",
        "graphql",
        "routes",
        "router",
        "controller",
        "endpoint",
        "contract",
        "dto",
        "types",
        "sdk",
        "api/",
        "/api/",
    ];
    let mut out = Vec::new();
    for file in changed_files {
        let lower = file.replace('\\', "/").to_ascii_lowercase();
        if MARKERS.iter().any(|m| lower.contains(m)) {
            out.push(file.replace('\\', "/"));
        }
    }
    out.sort();
    out.dedup();
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strict_store_parser_rejects_corrupt_and_unsupported_versions() {
        assert!(parse_workspace_store_strict("{broken").is_err());
        assert!(parse_workspace_store_strict(r#"{"version":0,"workspaces":[]}"#).is_err());
        assert!(parse_workspace_store_strict(r#"{"version":99,"workspaces":[]}"#).is_err());
        let ok = parse_workspace_store_strict(r#"{"version":1,"workspaces":[]}"#).unwrap();
        assert_eq!(ok.version, 1);
    }

    #[test]
    fn manifest_rejects_path_traversal_and_absolute_paths() {
        let traversal =
            r#"{"version":1,"name":"ws","members":[{"name":"evil","relative_path":"../outside"}]}"#;
        assert!(parse_workspace_manifest_strict(traversal).is_err());
        let abs = r#"{"version":1,"name":"ws","members":[{"name":"evil","relative_path":"/etc/passwd"}]}"#;
        assert!(parse_workspace_manifest_strict(abs).is_err());
        let valid = r#"{"version":1,"name":"ws","members":[{"name":"api","relative_path":"services/api"}]}"#;
        assert!(parse_workspace_manifest_strict(valid).is_ok());
    }

    #[test]
    fn dependency_cycle_detection_catches_direct_and_transitive_cycles() {
        let deps = vec![WorkspaceDependency {
            id: "DEP-001".into(),
            from: "shared".into(),
            to: "backend".into(),
            kind: "shared_schema".into(),
            required: true,
            contract_paths: vec![],
            notes: None,
            created_at: "now".into(),
        }];
        assert!(would_create_dep_cycle(&deps, "backend", "backend"));
        assert!(would_create_dep_cycle(&deps, "backend", "shared"));
        assert!(!would_create_dep_cycle(&deps, "backend", "web"));
    }

    #[test]
    fn impact_dispositions_require_reasons_for_waivers_and_no_change() {
        assert!(validate_impact_disposition("no_change_needed", None, None, None).is_err());
        assert!(validate_impact_disposition("waived", Some("   "), None, None).is_err());
        assert!(
            validate_impact_disposition("waived", Some("Internal refactor only"), None, None)
                .is_ok()
        );
        assert!(validate_impact_disposition("updated", None, None, None).is_err());
        assert!(validate_impact_disposition("updated", None, Some("Updated client"), None).is_ok());
    }

    #[test]
    fn contract_path_matching_handles_prefixes_and_globs() {
        let changed = vec![
            "openapi/v1.yaml".to_string(),
            "src/routes/auth.rs".to_string(),
            "README.md".to_string(),
        ];
        let matched = match_contract_paths(&changed, &["openapi".into(), "src/routes/*.rs".into()]);
        assert_eq!(matched, vec!["openapi/v1.yaml", "src/routes/auth.rs"]);
    }
}
