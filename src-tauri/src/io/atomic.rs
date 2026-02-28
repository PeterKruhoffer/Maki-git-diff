use std::path::Path;

use anyhow::{Context, Result};
use serde::Serialize;

pub fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    let parent = path.parent().context("Output path must have a parent")?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .context("Output file name must be valid UTF-8")?;

    let tmp_name = format!(".{file_name}.tmp.{}", std::process::id());
    let tmp_path = parent.join(tmp_name);

    let payload = serde_json::to_vec_pretty(value)?;
    std::fs::write(&tmp_path, payload)?;
    std::fs::rename(&tmp_path, path)?;

    Ok(())
}
