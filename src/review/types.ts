export type ReviewDecision =
  | "approve"
  | "request_changes"
  | "reject"
  | "ask_question";

export type CommentSide = "old" | "new";

export type CommentSeverity =
  | "critical"
  | "suggestion"
  | "nitpick"
  | "question";

export type FileStatus =
  | "Added"
  | "Deleted"
  | "Modified"
  | "Renamed"
  | "Copied"
  | "TypeChange";

export type HunkLineKind = "context" | "add" | "del";

export interface ReviewRequest {
  session_id: string;
  timestamp: string;
  agent_prompt: string;
  agent_notes?: string;
  repo_path: string;
  base_ref: string;
  head_ref?: string;
  iteration: number;
  previous_feedback?: ReviewResponse[];
}

export interface HunkLine {
  kind: HunkLineKind;
  old_line?: number;
  new_line?: number;
  text: string;
}

export interface Hunk {
  header: string;
  lines: HunkLine[];
}

export interface FileDiffSummary {
  old_path?: string;
  new_path: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  is_binary: boolean;
}

export interface FileDiff extends FileDiffSummary {
  hunks?: Hunk[];
}

export interface LineComment {
  id: string;
  file_path: string;
  side: CommentSide;
  line_start: number;
  line_end?: number;
  severity: CommentSeverity;
  instruction: string;
  code_context: string;
  context_fingerprint: string;
  hunk_header?: string;
}

export interface DraftLineComment extends LineComment {
  is_outdated: boolean;
}

export interface ReviewResponse {
  session_id: string;
  timestamp: string;
  decision: ReviewDecision;
  general_feedback: string;
  line_comments: LineComment[];
  suggested_prompt?: string;
  question?: string;
  cancelled?: boolean;
  warnings?: string[];
  repo_head_before?: string;
  repo_head_after?: string;
  review_duration_ms: number;
}

export type DiffRow =
  | {
      type: "header";
      key: string;
      header: string;
    }
  | {
      type: "line";
      key: string;
      filePath: string;
      hunkHeader: string;
      kind: HunkLineKind;
      oldLine?: number;
      newLine?: number;
      text: string;
    };

export type DiffLineRow = Extract<DiffRow, { type: "line" }>;

export interface LineSelection {
  filePath: string;
  side: CommentSide;
  lineStart: number;
  lineEnd: number;
  hunkHeader?: string;
}

export interface CommentAnchor {
  filePath: string;
  side: CommentSide;
  lineNumber: number;
}
