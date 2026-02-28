import type {
  CommentSide,
  DiffLineRow,
  DiffRow,
  FileDiff,
  LineComment,
  ReviewDecision,
  ReviewRequest,
  ReviewResponse,
} from "./types";

export const ROW_HEIGHT = 24;

export function buildDiffRows(diff: FileDiff | null): DiffRow[] {
  if (!diff || !diff.hunks) {
    return [];
  }

  const rows: DiffRow[] = [];
  for (const hunk of diff.hunks) {
    rows.push({
      type: "header",
      key: `${diff.new_path}:${hunk.header}`,
      header: hunk.header,
    });

    hunk.lines.forEach((line, index) => {
      rows.push({
        type: "line",
        key: `${diff.new_path}:${hunk.header}:${index}`,
        filePath: diff.new_path,
        hunkHeader: hunk.header,
        kind: line.kind,
        oldLine: line.old_line,
        newLine: line.new_line,
        text: line.text,
      });
    });
  }

  return rows;
}

export function lineDomKey(filePath: string, side: CommentSide, lineNumber: number) {
  return `${filePath}:${side}:${lineNumber}`;
}

export function normalizeForHash(value: string) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, " "))
    .join("\n");
}

export function fnv1aHex(input: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    const charCode = input.charCodeAt(i);
    hash = hash ^ charCode;
    hash = Math.imul(hash, 0x01000193);
  }

  const unsignedHash = hash >>> 0;
  return unsignedHash.toString(16).padStart(8, "0");
}

export function buildContextSnippet(
  rows: DiffRow[],
  filePath: string,
  side: CommentSide,
  lineStart: number,
  lineEnd: number,
) {
  const lines = rows
    .filter((row): row is DiffLineRow => row.type === "line")
    .filter((row) => row.filePath === filePath)
    .filter((row) => {
      const lineNumber = side === "new" ? row.newLine : row.oldLine;
      return lineNumber !== undefined;
    });

  const firstIndex = lines.findIndex((row) => {
    const lineNumber = side === "new" ? row.newLine : row.oldLine;
    return (lineNumber ?? 0) >= lineStart;
  });

  if (firstIndex < 0) {
    return "";
  }

  let lastIndex = firstIndex;
  for (let i = firstIndex; i < lines.length; i += 1) {
    const lineNumber = side === "new" ? lines[i].newLine : lines[i].oldLine;
    if ((lineNumber ?? 0) <= lineEnd) {
      lastIndex = i;
    } else {
      break;
    }
  }

  const from = Math.max(0, firstIndex - 3);
  const to = Math.min(lines.length - 1, lastIndex + 3);
  const extracted = lines.slice(from, to + 1);

  return extracted
    .map((row) => {
      const lineNumber = side === "new" ? row.newLine : row.oldLine;
      const safeNumber = (lineNumber ?? 0).toString().padStart(5, " ");
      return `${safeNumber} ${row.text}`;
    })
    .join("\n");
}

export function deriveSelectionTarget(row: DiffLineRow, preferredSide?: CommentSide) {
  const side: CommentSide = preferredSide ?? (row.newLine !== undefined ? "new" : "old");
  const lineNumber =
    side === "new" ? (row.newLine ?? row.oldLine) : (row.oldLine ?? row.newLine);

  if (lineNumber === undefined) {
    return null;
  }

  return { side, lineNumber };
}

function formatDecision(value: ReviewDecision) {
  switch (value) {
    case "approve":
      return "Nitpick";
    case "request_changes":
      return "Suggestion";
    case "reject":
      return "Critical";
    case "ask_question":
      return "Question";
    default:
      return value;
  }
}

function formatLineReference(comment: LineComment) {
  const lineSuffix =
    comment.line_end && comment.line_end > comment.line_start
      ? `-${comment.line_end}`
      : "";
  return `${comment.file_path}:${comment.line_start}${lineSuffix} (${comment.side})`;
}

function formatMultilineBlock(label: string, value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return `${label}\n(none)`;
  }

  return `${label}\n${trimmed}`;
}

function formatFeedbackEntry(entry: ReviewResponse, title: string) {
  const lines: string[] = [];
  const trimmedPrompt = entry.suggested_prompt?.trim();
  const trimmedQuestion = entry.question?.trim();

  lines.push(title);
  lines.push(`Timestamp: ${entry.timestamp}`);
  lines.push(`Decision: ${formatDecision(entry.decision)}`);
  lines.push(`Cancelled: ${entry.cancelled ? "yes" : "no"}`);

  if (entry.review_duration_ms > 0) {
    lines.push(`Review duration: ${entry.review_duration_ms}ms`);
  }

  lines.push("");
  lines.push(formatMultilineBlock("General feedback:", entry.general_feedback));

  if (trimmedPrompt) {
    lines.push("");
    lines.push(formatMultilineBlock("Suggested replacement prompt:", trimmedPrompt));
  }

  if (trimmedQuestion) {
    lines.push("");
    lines.push(formatMultilineBlock("Blocking question:", trimmedQuestion));
  }

  lines.push("");
  lines.push(`Line comments (${entry.line_comments.length}):`);

  if (entry.line_comments.length === 0) {
    lines.push("(none)");
  } else {
    entry.line_comments.forEach((comment, index) => {
      lines.push(`${index + 1}. [${comment.severity}] ${formatLineReference(comment)}`);
      lines.push(`Instruction: ${comment.instruction}`);
      if (comment.code_context.trim()) {
        lines.push("Code context:");
        lines.push(comment.code_context);
      }
      lines.push("");
    });
  }

  if (entry.warnings && entry.warnings.length > 0) {
    lines.push(`Warnings: ${entry.warnings.join(" | ")}`);
  }

  return lines.join("\n").trim();
}

interface FeedbackExportInput {
  reviewContext: ReviewRequest | null;
  generalFeedback: string;
  decision: ReviewDecision;
  comments: LineComment[];
}

export function buildFeedbackExport(input: FeedbackExportInput) {
  const now = new Date().toISOString();
  const trimmedFeedback = input.generalFeedback.trim();
  const currentDecision = input.decision;

  const currentDraft: ReviewResponse = {
    session_id: input.reviewContext?.session_id ?? "unspecified",
    timestamp: now,
    decision: currentDecision,
    general_feedback: trimmedFeedback,
    line_comments: input.comments,
    suggested_prompt: undefined,
    question: currentDecision === "ask_question" ? trimmedFeedback || undefined : undefined,
    cancelled: undefined,
    review_duration_ms: 0,
  };

  const sections: string[] = [];
  sections.push("OpenCode Review Feedback Export");
  sections.push(`Generated at: ${now}`);

  if (input.reviewContext) {
    sections.push(`Session: ${input.reviewContext.session_id}`);
    sections.push(`Iteration: ${input.reviewContext.iteration}`);
    sections.push(`Repository: ${input.reviewContext.repo_path}`);
    sections.push(
      `Refs: ${input.reviewContext.base_ref} -> ${
        input.reviewContext.head_ref ?? "working tree"
      }`,
    );
  }

  const previousFeedback = input.reviewContext?.previous_feedback ?? [];
  if (previousFeedback.length > 0) {
    sections.push("");
    sections.push(`Previous submitted feedback (${previousFeedback.length}):`);
    previousFeedback.forEach((entry, index) => {
      sections.push("");
      sections.push(formatFeedbackEntry(entry, `Submitted review #${index + 1}`));
    });
  }

  sections.push("");
  sections.push(formatFeedbackEntry(currentDraft, "Current draft (not yet submitted)"));

  return sections.join("\n").trim();
}
