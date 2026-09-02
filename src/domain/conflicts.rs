use std::path::Path;

use super::paths::is_protected_relative;

#[derive(Clone, Debug)]
pub enum PlannedWrite {
    Create { relative: String },
    Overwrite { relative: String },
    Skip { relative: String, reason: String },
    Gitignore { action: String },
    Db { action: String, path: String },
}

pub fn classify_file_plan(target_dir: &Path, relative: &str, force: bool) -> PlannedWrite {
    let abs = target_dir.join(relative);
    if !abs.exists() {
        return PlannedWrite::Create {
            relative: relative.to_string(),
        };
    }
    if force {
        return PlannedWrite::Overwrite {
            relative: relative.to_string(),
        };
    }
    if is_protected_relative(relative) {
        PlannedWrite::Skip {
            relative: relative.to_string(),
            reason: "protected path exists (use --force to overwrite with backup)".into(),
        }
    } else {
        PlannedWrite::Skip {
            relative: relative.to_string(),
            reason: "already exists".into(),
        }
    }
}

pub fn blocking_conflicts(plans: &[PlannedWrite], force: bool) -> Vec<String> {
    if force {
        return Vec::new();
    }
    plans
        .iter()
        .filter_map(|p| match p {
            PlannedWrite::Skip { relative, reason } if reason.contains("protected") => {
                Some(relative.clone())
            }
            _ => None,
        })
        .collect()
}
