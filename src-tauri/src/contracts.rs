use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewRequest {
    pub session_id: String,
    pub timestamp: String,
    pub agent_prompt: String,
    pub agent_notes: Option<String>,
    pub repo_path: String,
    pub base_ref: String,
    pub head_ref: Option<String>,
    pub precomputed_diff: Option<Vec<FileDiff>>,
    pub iteration: u32,
    pub previous_feedback: Option<Vec<ReviewResponse>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewResponse {
    pub session_id: String,
    pub timestamp: String,
    pub decision: ReviewDecision,
    pub general_feedback: String,
    pub line_comments: Vec<LineComment>,
    pub suggested_prompt: Option<String>,
    pub question: Option<String>,
    pub cancelled: Option<bool>,
    pub warnings: Option<Vec<String>>,
    pub repo_head_before: Option<String>,
    pub repo_head_after: Option<String>,
    pub review_duration_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReviewDecision {
    Approve,
    RequestChanges,
    Reject,
    AskQuestion,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LineComment {
    pub id: String,
    pub file_path: String,
    pub side: CommentSide,
    pub line_start: u32,
    pub line_end: Option<u32>,
    pub severity: CommentSeverity,
    pub instruction: String,
    pub code_context: String,
    pub context_fingerprint: String,
    pub hunk_header: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommentSide {
    Old,
    New,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CommentSeverity {
    Critical,
    Suggestion,
    Nitpick,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileDiff {
    pub old_path: Option<String>,
    pub new_path: String,
    pub status: FileStatus,
    pub additions: usize,
    pub deletions: usize,
    pub is_binary: bool,
    pub hunks: Option<Vec<Hunk>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub enum FileStatus {
    Added,
    Deleted,
    Modified,
    Renamed,
    Copied,
    TypeChange,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Hunk {
    pub header: String,
    pub lines: Vec<HunkLine>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HunkLine {
    pub kind: HunkLineKind,
    pub old_line: Option<u32>,
    pub new_line: Option<u32>,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HunkLineKind {
    Context,
    Add,
    Del,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileDiffSummary {
    pub old_path: Option<String>,
    pub new_path: String,
    pub status: FileStatus,
    pub additions: usize,
    pub deletions: usize,
    pub is_binary: bool,
}
