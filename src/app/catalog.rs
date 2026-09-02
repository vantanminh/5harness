use std::path::Path;

use crate::domain::entities::ENTITY_TYPES;
use crate::domain::frontmatter::{as_bool01, as_string, as_string_array, Frontmatter};
use crate::error::Result;
use crate::infra::entities::{list_entity_files, EntityFile};

#[derive(Clone, Debug)]
pub struct CatalogEntry {
    pub id: String,
    pub ty: String,
    pub path: String,
    pub title: String,
    pub status: String,
    pub mtime_ms: u128,
    pub data: Frontmatter,
}

pub struct ProjectCatalog {
    pub entries: Vec<CatalogEntry>,
}

pub fn file_to_catalog_entry(file: &EntityFile) -> CatalogEntry {
    let id = as_string(&file.data, "id").unwrap_or_else(|| {
        Path::new(&file.relative_path)
            .file_stem()
            .map(|s| s.to_string_lossy().into_owned())
            .unwrap_or_default()
    });
    let ty = as_string(&file.data, "type").unwrap_or_else(|| "story".into());
    let title = if ty == "intake" || ty == "report" {
        as_string(&file.data, "summary").unwrap_or_else(|| id.clone())
    } else {
        as_string(&file.data, "title").unwrap_or_else(|| id.clone())
    };
    let mtime_ms = file
        .absolute_path
        .metadata()
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);
    CatalogEntry {
        id,
        ty: ty.clone(),
        path: file.relative_path.replace('\\', "/"),
        title,
        status: as_string(&file.data, "status").unwrap_or_default(),
        mtime_ms,
        data: file.data.clone(),
    }
}

pub fn build_catalog(project_root: &Path) -> Result<ProjectCatalog> {
    let mut entries = Vec::new();
    for ty in ENTITY_TYPES {
        for file in list_entity_files(project_root, ty)? {
            let mut entry = file_to_catalog_entry(&file);
            if !ENTITY_TYPES.contains(&entry.ty.as_str()) {
                entry.ty = (*ty).to_string();
            }
            entries.push(entry);
        }
    }
    entries.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(ProjectCatalog { entries })
}

pub fn by_type<'a>(catalog: &'a ProjectCatalog, ty: &str) -> Vec<&'a CatalogEntry> {
    catalog.entries.iter().filter(|e| e.ty == ty).collect()
}

pub fn proof01(data: &Frontmatter, key: &str) -> i64 {
    as_bool01(data, key).unwrap_or(0)
}

pub fn links_of(data: &Frontmatter) -> Vec<String> {
    as_string_array(data, "links").unwrap_or_default()
}
