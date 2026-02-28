use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Instant;

use anyhow::{anyhow, Result};

use crate::contracts::{FileDiff, FileDiffSummary, ReviewRequest};
use crate::git;
use crate::io::atomic;

pub struct DiffStore {
    files: Vec<FileDiff>,
    by_new_path: HashMap<String, usize>,
    by_old_path: HashMap<String, usize>,
}

impl DiffStore {
    fn new(files: Vec<FileDiff>) -> Self {
        let mut by_new_path = HashMap::new();
        let mut by_old_path = HashMap::new();

        for (index, file) in files.iter().enumerate() {
            by_new_path.insert(file.new_path.clone(), index);
            if let Some(old_path) = &file.old_path {
                by_old_path.insert(old_path.clone(), index);
            }
        }

        Self {
            files,
            by_new_path,
            by_old_path,
        }
    }

    fn find(&self, file_path: &str) -> Option<&FileDiff> {
        self.by_new_path
            .get(file_path)
            .or_else(|| self.by_old_path.get(file_path))
            .and_then(|index| self.files.get(*index))
    }
}

pub struct AppState {
    pub request: ReviewRequest,
    pub output_path: Option<PathBuf>,
    pub repo: gix::Repository,
    pub repo_head_before: Option<String>,
    pub start_time: Instant,
    pub finished: bool,
    diff_store: Option<DiffStore>,
}

impl AppState {
    pub fn new(
        request: ReviewRequest,
        output_path: Option<PathBuf>,
        repo: gix::Repository,
        repo_head_before: Option<String>,
    ) -> Self {
        Self {
            request,
            output_path,
            repo,
            repo_head_before,
            start_time: Instant::now(),
            finished: false,
            diff_store: None,
        }
    }

    pub fn refresh_diffs(&mut self) -> Result<()> {
        let diffs = git::diff::compute_file_diffs(&self.request, &self.repo)?;
        self.diff_store = Some(DiffStore::new(diffs));

        Ok(())
    }

    pub fn ensure_diffs(&mut self) -> Result<()> {
        if self.diff_store.is_none() {
            self.refresh_diffs()?;
        }

        Ok(())
    }

    pub fn file_list(&mut self) -> Result<Vec<FileDiffSummary>> {
        self.refresh_diffs()?;

        let store = self
            .diff_store
            .as_ref()
            .ok_or_else(|| anyhow!("Diffs are not available"))?;

        Ok(store
            .files
            .iter()
            .map(|file| FileDiffSummary {
                old_path: file.old_path.clone(),
                new_path: file.new_path.clone(),
                status: file.status.clone(),
                additions: file.additions,
                deletions: file.deletions,
                is_binary: file.is_binary,
            })
            .collect())
    }

    pub fn file_diff(&mut self, file_path: &str) -> Result<FileDiff> {
        self.ensure_diffs()?;

        let store = self
            .diff_store
            .as_ref()
            .ok_or_else(|| anyhow!("Diffs are not available"))?;

        store
            .find(file_path)
            .cloned()
            .ok_or_else(|| anyhow!("No file diff found for '{file_path}'"))
    }

    pub fn write_response<T: serde::Serialize>(&self, response: &T) -> Result<()> {
        if let Some(path) = &self.output_path {
            atomic::write_json_atomic(path, response)?;
        }

        Ok(())
    }
}
