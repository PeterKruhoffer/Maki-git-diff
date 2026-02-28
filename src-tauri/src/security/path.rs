use std::path::{Component, Path, PathBuf};

use anyhow::{bail, Result};

pub fn validate_repo_relative_path(repo_root: &Path, relative_path: &str) -> Result<PathBuf> {
    let path = Path::new(relative_path);

    if path.is_absolute() {
        bail!("Absolute file paths are not allowed");
    }

    for component in path.components() {
        match component {
            Component::CurDir | Component::Normal(_) => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                bail!("Path traversal is not allowed")
            }
        }
    }

    Ok(repo_root.join(path))
}
