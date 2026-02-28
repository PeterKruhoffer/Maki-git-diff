use std::path::{Path, PathBuf};

use anyhow::{anyhow, Result};

pub fn open_repository(repo_path: &Path) -> Result<gix::Repository> {
    Ok(gix::discover(repo_path)?)
}

pub fn repository_root(repo: &gix::Repository) -> PathBuf {
    repo.workdir()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| repo.path().to_path_buf())
}

pub fn resolve_tree<'repo>(repo: &'repo gix::Repository, spec: &str) -> Result<gix::Tree<'repo>> {
    let id = repo.rev_parse_single(spec)?;
    let object = id.object()?;
    let tree = object
        .peel_to_tree()
        .map_err(|err| anyhow!("Failed to peel '{spec}' to tree: {err}"))?;
    Ok(tree)
}

pub fn current_head_oid(repo: &gix::Repository) -> Option<String> {
    repo.head_id().ok().map(|id| id.to_string())
}
