mod cli;
mod contracts;
mod git;
mod io;
mod security;
mod state;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use anyhow::{Context, Result};
use chrono::SecondsFormat;
use tauri::{Manager, State, WindowEvent};

use crate::cli::{AppMode, CliOptions};
use crate::contracts::{FileDiff, FileDiffSummary, ReviewDecision, ReviewRequest, ReviewResponse};
use crate::state::AppState;

struct SharedState(Mutex<AppState>);

#[tauri::command]
fn get_context(state: State<'_, SharedState>) -> Result<ReviewRequest, String> {
    let state = state.0.lock().map_err(|err| err.to_string())?;
    Ok(state.request.clone())
}

#[tauri::command]
fn get_file_list(state: State<'_, SharedState>) -> Result<Vec<FileDiffSummary>, String> {
    let mut state = state.0.lock().map_err(|err| err.to_string())?;
    state.file_list().map_err(|err| err.to_string())
}

#[tauri::command]
fn load_file_diff(file_path: String, state: State<'_, SharedState>) -> Result<FileDiff, String> {
    let mut state = state.0.lock().map_err(|err| err.to_string())?;

    security::path::validate_repo_relative_path(Path::new(&state.request.repo_path), &file_path)
        .map_err(|err| err.to_string())?;

    state.file_diff(&file_path).map_err(|err| err.to_string())
}

#[tauri::command]
fn submit_review(
    app_handle: tauri::AppHandle,
    response: ReviewResponse,
    state: State<'_, SharedState>,
) -> Result<(), String> {
    let mut state = state.0.lock().map_err(|err| err.to_string())?;

    if state.finished {
        return Ok(());
    }

    if response.session_id != state.request.session_id {
        return Err("Session id mismatch while submitting review".to_string());
    }

    let mut finalized = response;
    finalized.timestamp = now_iso_timestamp();
    finalized.review_duration_ms = state.start_time.elapsed().as_millis() as u64;
    finalized.repo_head_before = state.repo_head_before.clone();
    finalized.repo_head_after = git::resolve::current_head_oid(&state.repo);

    if finalized.repo_head_before != finalized.repo_head_after {
        let mut warnings = finalized.warnings.unwrap_or_default();
        warnings.push("Repository HEAD changed during review".to_string());
        finalized.warnings = Some(warnings);
    }

    state
        .write_response(&finalized)
        .map_err(|err| err.to_string())?;
    state.finished = true;
    drop(state);

    app_handle.exit(0);
    Ok(())
}

#[tauri::command]
fn cancel_review(
    app_handle: tauri::AppHandle,
    reason: Option<String>,
    state: State<'_, SharedState>,
) -> Result<(), String> {
    cancel_internal(app_handle, reason, state, 1)
}

fn cancel_internal(
    app_handle: tauri::AppHandle,
    reason: Option<String>,
    state: State<'_, SharedState>,
    exit_code: i32,
) -> Result<(), String> {
    let mut state = state.0.lock().map_err(|err| err.to_string())?;
    if state.finished {
        return Ok(());
    }

    let feedback = reason.unwrap_or_else(|| "Review cancelled by user".to_string());

    let mut response = ReviewResponse {
        session_id: state.request.session_id.clone(),
        timestamp: now_iso_timestamp(),
        decision: ReviewDecision::Reject,
        general_feedback: feedback,
        line_comments: Vec::new(),
        suggested_prompt: None,
        question: None,
        cancelled: Some(true),
        warnings: None,
        repo_head_before: state.repo_head_before.clone(),
        repo_head_after: git::resolve::current_head_oid(&state.repo),
        review_duration_ms: state.start_time.elapsed().as_millis() as u64,
    };

    if response.repo_head_before != response.repo_head_after {
        response.warnings = Some(vec!["Repository HEAD changed during review".to_string()]);
    }

    state
        .write_response(&response)
        .map_err(|err| err.to_string())?;
    state.finished = true;
    drop(state);

    app_handle.exit(exit_code);
    Ok(())
}

fn now_iso_timestamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

fn load_review_request(path: &Path) -> Result<ReviewRequest> {
    let payload = std::fs::read_to_string(path)
        .with_context(|| format!("Unable to read review request at {}", path.display()))?;
    let request: ReviewRequest = serde_json::from_str(&payload)
        .with_context(|| format!("Invalid review request JSON at {}", path.display()))?;
    Ok(request)
}

fn standalone_request(repo_path: PathBuf) -> ReviewRequest {
    ReviewRequest {
        session_id: format!("standalone-{}", std::process::id()),
        timestamp: now_iso_timestamp(),
        agent_prompt: "Standalone review mode".to_string(),
        agent_notes: Some("Launched without --review".to_string()),
        repo_path: repo_path.to_string_lossy().to_string(),
        base_ref: "HEAD".to_string(),
        head_ref: None,
        precomputed_diff: None,
        iteration: 1,
        previous_feedback: None,
    }
}

fn initialize_state(cli: &CliOptions) -> Result<AppState> {
    let (mut request, output_path) = match &cli.mode {
        AppMode::Gui => {
            let cwd = std::env::current_dir().context("Unable to determine current directory")?;
            (standalone_request(cwd), None)
        }
        AppMode::Review {
            input_path,
            output_path,
        } => {
            let request = load_review_request(input_path)?;
            (request, Some(output_path.clone()))
        }
    };

    let repo = git::resolve::open_repository(Path::new(&request.repo_path))
        .with_context(|| format!("Unable to open git repository at {}", request.repo_path))?;
    request.repo_path = git::resolve::repository_root(&repo)
        .to_string_lossy()
        .to_string();
    let head_before = git::resolve::current_head_oid(&repo);

    Ok(AppState::new(request, output_path, repo, head_before))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cli = match cli::parse_args() {
        Ok(parsed) => parsed,
        Err(err) => {
            eprintln!("{err}");
            std::process::exit(2);
        }
    };

    let _ = cli.log_level.as_deref();
    let _ = cli.use_stdio;

    let app_state = match initialize_state(&cli) {
        Ok(state) => state,
        Err(err) => {
            eprintln!("{err:#}");
            std::process::exit(2);
        }
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(SharedState(Mutex::new(app_state)))
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                let app_handle = window.app_handle();
                let state = app_handle.state::<SharedState>();
                let _ = cancel_internal(
                    app_handle.clone(),
                    Some("Review cancelled by user".to_string()),
                    state,
                    1,
                );
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_context,
            get_file_list,
            load_file_diff,
            submit_review,
            cancel_review
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
