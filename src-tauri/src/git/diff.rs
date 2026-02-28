use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use anyhow::{anyhow, Result};
use gix::diff::tree_with_rewrites::Change as TreeChange;
use gix::object::tree::{EntryKind, EntryMode};
use ignore::WalkBuilder;
use similar::{ChangeTag, TextDiff};

use crate::contracts::{FileDiff, FileStatus, Hunk, HunkLine, HunkLineKind, ReviewRequest};
use crate::git::resolve;

const BINARY_SCAN_BYTES: usize = 8192;

#[derive(Clone)]
struct BaseEntry {
    mode: EntryMode,
    id: gix::ObjectId,
}

pub fn compute_file_diffs(
    request: &ReviewRequest,
    repo: &gix::Repository,
) -> Result<Vec<FileDiff>> {
    if let Some(precomputed) = &request.precomputed_diff {
        return Ok(precomputed.clone());
    }

    match request.head_ref.as_deref() {
        Some(head_ref) => tree_to_tree_diff(repo, &request.base_ref, head_ref),
        None => working_tree_diff(repo, Path::new(&request.repo_path), &request.base_ref),
    }
}

fn tree_to_tree_diff(
    repo: &gix::Repository,
    base_ref: &str,
    head_ref: &str,
) -> Result<Vec<FileDiff>> {
    let base_tree = resolve::resolve_tree(repo, base_ref)?;
    let head_tree = resolve::resolve_tree(repo, head_ref)?;
    let changes = repo.diff_tree_to_tree(Some(&base_tree), Some(&head_tree), None)?;

    let mut files = Vec::new();

    for change in changes {
        match change {
            TreeChange::Addition {
                location,
                entry_mode,
                id,
                ..
            } => {
                if !is_file_mode(entry_mode) {
                    continue;
                }

                let new_path = bstring_to_string(&location);
                let new_bytes = load_blob_bytes(repo, &id)?;
                let (additions, deletions, is_binary, hunks) = build_hunks(&[], &new_bytes);

                files.push(FileDiff {
                    old_path: None,
                    new_path,
                    status: FileStatus::Added,
                    additions,
                    deletions,
                    is_binary,
                    hunks,
                });
            }
            TreeChange::Deletion {
                location,
                entry_mode,
                id,
                ..
            } => {
                if !is_file_mode(entry_mode) {
                    continue;
                }

                let path = bstring_to_string(&location);
                let old_bytes = load_blob_bytes(repo, &id)?;
                let (additions, deletions, is_binary, hunks) = build_hunks(&old_bytes, &[]);

                files.push(FileDiff {
                    old_path: Some(path.clone()),
                    new_path: path,
                    status: FileStatus::Deleted,
                    additions,
                    deletions,
                    is_binary,
                    hunks,
                });
            }
            TreeChange::Modification {
                location,
                previous_entry_mode,
                previous_id,
                entry_mode,
                id,
                ..
            } => {
                let path = bstring_to_string(&location);

                if is_file_mode(previous_entry_mode) && is_file_mode(entry_mode) {
                    let old_bytes = load_blob_bytes(repo, &previous_id)?;
                    let new_bytes = load_blob_bytes(repo, &id)?;
                    let (additions, deletions, is_binary, hunks) =
                        build_hunks(&old_bytes, &new_bytes);

                    files.push(FileDiff {
                        old_path: Some(path.clone()),
                        new_path: path,
                        status: FileStatus::Modified,
                        additions,
                        deletions,
                        is_binary,
                        hunks,
                    });
                } else {
                    files.push(FileDiff {
                        old_path: Some(path.clone()),
                        new_path: path,
                        status: FileStatus::TypeChange,
                        additions: 0,
                        deletions: 0,
                        is_binary: true,
                        hunks: None,
                    });
                }
            }
            TreeChange::Rewrite {
                source_location,
                source_entry_mode,
                source_id,
                entry_mode,
                id,
                location,
                copy,
                ..
            } => {
                let old_path = bstring_to_string(&source_location);
                let new_path = bstring_to_string(&location);

                if is_file_mode(source_entry_mode) && is_file_mode(entry_mode) {
                    let old_bytes = load_blob_bytes(repo, &source_id)?;
                    let new_bytes = load_blob_bytes(repo, &id)?;
                    let (additions, deletions, is_binary, hunks) =
                        build_hunks(&old_bytes, &new_bytes);

                    files.push(FileDiff {
                        old_path: Some(old_path),
                        new_path,
                        status: if copy {
                            FileStatus::Copied
                        } else {
                            FileStatus::Renamed
                        },
                        additions,
                        deletions,
                        is_binary,
                        hunks,
                    });
                }
            }
        }
    }

    files.sort_by(|a, b| a.new_path.cmp(&b.new_path));
    Ok(files)
}

fn working_tree_diff(
    repo: &gix::Repository,
    repo_root: &Path,
    base_ref: &str,
) -> Result<Vec<FileDiff>> {
    let base_tree = resolve::resolve_tree(repo, base_ref)?;
    let mut base_entries = BTreeMap::new();
    collect_base_entries(&base_tree, "", &mut base_entries)?;

    let work_entries = collect_worktree_files(repo_root)?;
    let mut all_paths = BTreeSet::new();
    all_paths.extend(base_entries.keys().cloned());
    all_paths.extend(work_entries.keys().cloned());

    let mut files = Vec::new();

    for path in all_paths {
        match (base_entries.get(&path), work_entries.get(&path)) {
            (Some(base), Some(new_bytes)) => {
                if !is_file_mode(base.mode) {
                    files.push(FileDiff {
                        old_path: Some(path.clone()),
                        new_path: path,
                        status: FileStatus::TypeChange,
                        additions: 0,
                        deletions: 0,
                        is_binary: true,
                        hunks: None,
                    });
                    continue;
                }

                let old_bytes = load_blob_bytes(repo, &base.id)?;
                if old_bytes != *new_bytes {
                    let (additions, deletions, is_binary, hunks) =
                        build_hunks(&old_bytes, new_bytes);
                    files.push(FileDiff {
                        old_path: Some(path.clone()),
                        new_path: path,
                        status: FileStatus::Modified,
                        additions,
                        deletions,
                        is_binary,
                        hunks,
                    });
                }
            }
            (Some(base), None) => {
                if !is_file_mode(base.mode) {
                    files.push(FileDiff {
                        old_path: Some(path.clone()),
                        new_path: path,
                        status: FileStatus::Deleted,
                        additions: 0,
                        deletions: 0,
                        is_binary: true,
                        hunks: None,
                    });
                    continue;
                }

                let old_bytes = load_blob_bytes(repo, &base.id)?;
                let (additions, deletions, is_binary, hunks) = build_hunks(&old_bytes, &[]);
                files.push(FileDiff {
                    old_path: Some(path.clone()),
                    new_path: path,
                    status: FileStatus::Deleted,
                    additions,
                    deletions,
                    is_binary,
                    hunks,
                });
            }
            (None, Some(new_bytes)) => {
                let (additions, deletions, is_binary, hunks) = build_hunks(&[], new_bytes);
                files.push(FileDiff {
                    old_path: None,
                    new_path: path,
                    status: FileStatus::Added,
                    additions,
                    deletions,
                    is_binary,
                    hunks,
                });
            }
            (None, None) => {}
        }
    }

    files.sort_by(|a, b| a.new_path.cmp(&b.new_path));
    Ok(files)
}

fn collect_base_entries(
    tree: &gix::Tree<'_>,
    prefix: &str,
    out: &mut BTreeMap<String, BaseEntry>,
) -> Result<()> {
    for entry in tree.iter() {
        let entry = entry?;
        let name = bstr_to_string(entry.filename());
        let path = if prefix.is_empty() {
            name
        } else {
            format!("{prefix}/{name}")
        };

        if entry.kind() == EntryKind::Tree {
            let object = entry.object()?;
            let child_tree = object.into_tree();
            collect_base_entries(&child_tree, &path, out)?;
        } else {
            out.insert(
                path,
                BaseEntry {
                    mode: entry.mode(),
                    id: entry.object_id(),
                },
            );
        }
    }

    Ok(())
}

fn collect_worktree_files(repo_root: &Path) -> Result<BTreeMap<String, Vec<u8>>> {
    let mut files = BTreeMap::new();
    let mut walker = WalkBuilder::new(repo_root);
    walker
        .hidden(false)
        .git_ignore(true)
        .git_exclude(true)
        .git_global(true);

    for entry in walker.build() {
        let entry = entry?;
        let path = entry.path();

        if path == repo_root {
            continue;
        }

        if path
            .strip_prefix(repo_root)
            .ok()
            .is_some_and(|relative| relative.starts_with(".git"))
        {
            continue;
        }

        if entry.file_type().is_some_and(|t| t.is_dir()) {
            continue;
        }

        let relative = path
            .strip_prefix(repo_root)
            .map_err(|err| anyhow!("Failed to derive relative path for {:?}: {err}", path))?
            .to_string_lossy()
            .replace('\\', "/");

        let bytes = if entry.file_type().is_some_and(|t| t.is_symlink()) {
            std::fs::read_link(path)?
                .to_string_lossy()
                .into_owned()
                .into_bytes()
        } else {
            std::fs::read(path)?
        };

        files.insert(relative, bytes);
    }

    Ok(files)
}

fn load_blob_bytes(repo: &gix::Repository, id: &gix::ObjectId) -> Result<Vec<u8>> {
    let object = repo.find_object(*id)?;
    if object.kind != gix::object::Kind::Blob {
        return Err(anyhow!("Object {id} is not a blob"));
    }

    let mut blob = object.into_blob();
    Ok(blob.take_data())
}

fn is_file_mode(mode: EntryMode) -> bool {
    matches!(
        mode.kind(),
        EntryKind::Blob | EntryKind::BlobExecutable | EntryKind::Link
    )
}

fn build_hunks(old_bytes: &[u8], new_bytes: &[u8]) -> (usize, usize, bool, Option<Vec<Hunk>>) {
    if is_binary_content(old_bytes) || is_binary_content(new_bytes) {
        return (0, 0, true, None);
    }

    let old_text = String::from_utf8_lossy(old_bytes);
    let new_text = String::from_utf8_lossy(new_bytes);
    let diff = TextDiff::from_lines(old_text.as_ref(), new_text.as_ref());

    let mut additions = 0usize;
    let mut deletions = 0usize;
    let mut hunks = Vec::new();

    for group in diff.grouped_ops(3) {
        if group.is_empty() {
            continue;
        }

        let old_start = group
            .iter()
            .map(|op| op.old_range().start)
            .min()
            .unwrap_or(0);
        let old_end = group
            .iter()
            .map(|op| op.old_range().end)
            .max()
            .unwrap_or(old_start);
        let new_start = group
            .iter()
            .map(|op| op.new_range().start)
            .min()
            .unwrap_or(0);
        let new_end = group
            .iter()
            .map(|op| op.new_range().end)
            .max()
            .unwrap_or(new_start);

        let old_count = old_end.saturating_sub(old_start);
        let new_count = new_end.saturating_sub(new_start);

        let mut lines = Vec::new();
        for op in group {
            for change in diff.iter_changes(&op) {
                let kind = match change.tag() {
                    ChangeTag::Equal => HunkLineKind::Context,
                    ChangeTag::Delete => {
                        deletions += 1;
                        HunkLineKind::Del
                    }
                    ChangeTag::Insert => {
                        additions += 1;
                        HunkLineKind::Add
                    }
                };

                lines.push(HunkLine {
                    kind,
                    old_line: change.old_index().map(|index| index as u32 + 1),
                    new_line: change.new_index().map(|index| index as u32 + 1),
                    text: change.value().trim_end_matches('\n').to_string(),
                });
            }
        }

        hunks.push(Hunk {
            header: format!(
                "@@ -{},{} +{},{} @@",
                old_start + 1,
                old_count,
                new_start + 1,
                new_count
            ),
            lines,
        });
    }

    (additions, deletions, false, Some(hunks))
}

fn is_binary_content(data: &[u8]) -> bool {
    data.iter().take(BINARY_SCAN_BYTES).any(|byte| *byte == 0)
}

fn bstring_to_string(value: &gix::bstr::BString) -> String {
    String::from_utf8_lossy(value.as_ref()).to_string()
}

fn bstr_to_string(value: &gix::bstr::BStr) -> String {
    String::from_utf8_lossy(value.as_ref()).to_string()
}
