use std::env;
use std::path::{Path, PathBuf};

use crate::error::{Error, Result};

pub fn resolve_package_root() -> Result<PathBuf> {
    if let Ok(explicit) = env::var("HARNESS_PACKAGE_ROOT") {
        let p = PathBuf::from(explicit.trim());
        if is_package_root(&p) {
            return Ok(p);
        }
    }
    let mut candidates = Vec::new();
    if let Ok(exe) = env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.to_path_buf());
            if let Some(parent) = dir.parent() {
                candidates.push(parent.to_path_buf());
                if let Some(grand) = parent.parent() {
                    candidates.push(grand.to_path_buf());
                    if let Some(gg) = grand.parent() {
                        candidates.push(gg.to_path_buf());
                    }
                }
            }
        }
    }
    if let Ok(cwd) = env::current_dir() {
        let mut cur = Some(cwd.as_path());
        while let Some(dir) = cur {
            candidates.push(dir.to_path_buf());
            cur = dir.parent();
        }
    }
    for candidate in candidates {
        if is_package_root(&candidate) {
            return Ok(candidate);
        }
    }
    Err(Error::new(
        "Could not locate package root (templates/manifest.json)",
    ))
}

fn is_package_root(path: &Path) -> bool {
    path.join("templates").join("manifest.json").is_file() && path.join("migrations").is_dir()
}
