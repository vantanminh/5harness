use std::path::{Path, PathBuf};

use crate::domain::paths::resolve_target_dir;
use crate::domain::project_id::extract_project_id;
use crate::domain::registry::{remove_project_by_path, upsert_project, RegistryProject};
use crate::error::{Error, Result};
use crate::infra::registry::{
    detect_git_remote, detect_project_name, get_registry_path, read_registry, write_registry,
};

use super::index::write_project_index;
use super::init::ensure_project_id;
use crate::infra::entities::MutationLock;

pub struct LinkResult {
    pub entry: RegistryProject,
    pub created: bool,
    pub registry_path: PathBuf,
}

pub fn link_project(path_input: Option<&str>, cwd: &Path) -> Result<LinkResult> {
    let absolute = resolve_target_dir(path_input, cwd);
    if !absolute.is_dir() {
        return Err(Error::new(format!(
            "Project path does not exist or is not a directory: {}",
            absolute.display()
        )));
    }
    let registry = read_registry();
    let name = detect_project_name(&absolute);
    let remote = detect_git_remote(&absolute);
    let project_id = if absolute.join("AGENTS.md").exists() {
        Some(ensure_project_id(&absolute, None)?)
    } else {
        None
    };
    let now = chrono::Utc::now().to_rfc3339();
    let (next, entry, created) =
        upsert_project(&registry, project_id, &absolute, &name, remote, &now)
            .map_err(Error::new)?;
    let registry_path = write_registry(&next)?;
    let _lock = MutationLock::acquire(&absolute)?;
    write_project_index(&absolute)?;
    Ok(LinkResult {
        entry,
        created,
        registry_path,
    })
}

pub fn unlink_project(
    path_input: Option<&str>,
    cwd: &Path,
) -> Result<(Option<RegistryProject>, PathBuf)> {
    let absolute = resolve_target_dir(path_input, cwd);
    let registry = read_registry();
    let (next, removed) = remove_project_by_path(&registry, &absolute);
    let registry_path = write_registry(&next)?;
    Ok((removed, registry_path))
}

pub fn list_projects() -> Vec<(RegistryProject, bool)> {
    crate::infra::registry::list_projects_with_status()
}

pub fn read_project_id(project_root: &Path) -> Result<String> {
    let agents = project_root.join("AGENTS.md");
    if !agents.exists() {
        return Err(Error::new(format!(
            "AGENTS.md not found in {}. Run `harness init` first.",
            project_root.display()
        )));
    }
    let text = std::fs::read_to_string(&agents)?;
    extract_project_id(&text).ok_or_else(|| {
        Error::new("No harness project id in AGENTS.md. Run `harness project id --ensure`.")
    })
}

pub fn registry_path() -> PathBuf {
    get_registry_path()
}
