import { invoke } from "@tauri-apps/api/core";
import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onMount,
} from "solid-js";
import "./App.css";

type ReviewDecision =
  | "approve"
  | "request_changes"
  | "reject"
  | "ask_question";
type CommentSide = "old" | "new";
type CommentSeverity = "critical" | "suggestion" | "nitpick" | "question";
type FileStatus =
  | "Added"
  | "Deleted"
  | "Modified"
  | "Renamed"
  | "Copied"
  | "TypeChange";
type HunkLineKind = "context" | "add" | "del";

interface ReviewRequest {
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

interface HunkLine {
  kind: HunkLineKind;
  old_line?: number;
  new_line?: number;
  text: string;
}

interface Hunk {
  header: string;
  lines: HunkLine[];
}

interface FileDiff {
  old_path?: string;
  new_path: string;
  status: FileStatus;
  additions: number;
  deletions: number;
  is_binary: boolean;
  hunks?: Hunk[];
}

interface LineComment {
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

interface ReviewResponse {
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

type DiffRow =
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

interface LineSelection {
  filePath: string;
  side: CommentSide;
  lineStart: number;
  lineEnd: number;
  hunkHeader?: string;
}

const ROW_HEIGHT = 24;

function App() {
  const [context, setContext] = createSignal<ReviewRequest | null>(null);
  const [files, setFiles] = createSignal<FileDiff[]>([]);
  const [selectedPath, setSelectedPath] = createSignal<string>("");
  const [selectedDiff, setSelectedDiff] = createSignal<FileDiff | null>(null);
  const [error, setError] = createSignal<string>("");
  const [loading, setLoading] = createSignal(true);

  const [decision, setDecision] = createSignal<ReviewDecision>("request_changes");
  const [generalFeedback, setGeneralFeedback] = createSignal("");

  const [comments, setComments] = createSignal<LineComment[]>([]);
  const [selection, setSelection] = createSignal<LineSelection | null>(null);
  const [commentSeverity, setCommentSeverity] =
    createSignal<CommentSeverity>("suggestion");
  const [commentInstruction, setCommentInstruction] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [copyStatus, setCopyStatus] = createSignal("");

  const [scrollTop, setScrollTop] = createSignal(0);
  const [viewportHeight, setViewportHeight] = createSignal(420);
  let diffContainerRef: HTMLDivElement | undefined;
  const lineElementMap = new Map<string, HTMLElement>();

  const diffRows = createMemo<DiffRow[]>(() => {
    const diff = selectedDiff();
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
  });

  const visibleRange = createMemo(() => {
    const total = diffRows().length;
    if (total === 0) {
      return { start: 0, end: 0, offsetY: 0, totalHeight: 0 };
    }

    const start = Math.max(0, Math.floor(scrollTop() / ROW_HEIGHT) - 20);
    const visibleCount = Math.ceil(viewportHeight() / ROW_HEIGHT) + 40;
    const end = Math.min(total, start + visibleCount);

    return {
      start,
      end,
      offsetY: start * ROW_HEIGHT,
      totalHeight: total * ROW_HEIGHT,
    };
  });

  const visibleRows = createMemo(() => {
    const range = visibleRange();
    return diffRows().slice(range.start, range.end).map((row, index) => ({
      row,
      absoluteIndex: range.start + index,
    }));
  });

  function lineDomKey(filePath: string, side: CommentSide, lineNumber: number) {
    return `${filePath}:${side}:${lineNumber}`;
  }

  function normalizeForHash(value: string) {
    return value
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/\s+/g, " "))
      .join("\n");
  }

  function fnv1aHex(input: string) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
  }

  function buildContextSnippet(
    filePath: string,
    side: CommentSide,
    lineStart: number,
    lineEnd: number,
  ) {
    const lines = diffRows()
      .filter((row): row is Extract<DiffRow, { type: "line" }> => row.type === "line")
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

  function deriveSelectionTarget(
    row: Extract<DiffRow, { type: "line" }>,
    preferredSide?: CommentSide,
  ) {
    const side: CommentSide =
      preferredSide ?? (row.newLine !== undefined ? "new" : "old");
    const lineNumber =
      side === "new"
        ? (row.newLine ?? row.oldLine)
        : (row.oldLine ?? row.newLine);

    if (lineNumber === undefined) {
      return null;
    }

    return { side, lineNumber };
  }

  function handleLineClick(
    row: Extract<DiffRow, { type: "line" }>,
    shiftKey: boolean,
  ) {
    const current = selection();
    const target = deriveSelectionTarget(row, current?.side);
    if (!target) {
      return;
    }

    if (
      shiftKey &&
      current &&
      current.filePath === row.filePath &&
      current.side === target.side
    ) {
      setSelection({
        ...current,
        lineStart: Math.min(current.lineStart, target.lineNumber),
        lineEnd: Math.max(current.lineStart, target.lineNumber),
        hunkHeader: row.hunkHeader,
      });
      return;
    }

    setSelection({
      filePath: row.filePath,
      side: target.side,
      lineStart: target.lineNumber,
      lineEnd: target.lineNumber,
      hunkHeader: row.hunkHeader,
    });
  }

  function resetCommentDraft() {
    setCommentInstruction("");
    setCommentSeverity("suggestion");
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
        lines.push(
          `${index + 1}. [${comment.severity}] ${formatLineReference(comment)}`,
        );
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

  function buildFeedbackExport() {
    const reviewContext = context();
    const now = new Date().toISOString();
    const trimmedFeedback = generalFeedback().trim();
    const currentDecision = decision();

    const currentDraft: ReviewResponse = {
      session_id: reviewContext?.session_id ?? "unspecified",
      timestamp: now,
      decision: currentDecision,
      general_feedback: trimmedFeedback,
      line_comments: comments(),
      suggested_prompt: undefined,
      question:
        currentDecision === "ask_question" ? trimmedFeedback || undefined : undefined,
      cancelled: undefined,
      review_duration_ms: 0,
    };

    const sections: string[] = [];
    sections.push("OpenCode Review Feedback Export");
    sections.push(`Generated at: ${now}`);

    if (reviewContext) {
      sections.push(`Session: ${reviewContext.session_id}`);
      sections.push(`Iteration: ${reviewContext.iteration}`);
      sections.push(`Repository: ${reviewContext.repo_path}`);
      sections.push(`Refs: ${reviewContext.base_ref} -> ${reviewContext.head_ref ?? "working tree"}`);
    }

    const previousFeedback = reviewContext?.previous_feedback ?? [];
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

  async function copyTextToClipboard(value: string) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }

    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();

    const copied = document.execCommand("copy");
    document.body.removeChild(textarea);

    if (!copied) {
      throw new Error("Clipboard API is unavailable.");
    }
  }

  async function copyAllFeedback() {
    try {
      await copyTextToClipboard(buildFeedbackExport());
      setCopyStatus("Copied all review feedback to clipboard.");
    } catch (err) {
      setCopyStatus(`Unable to copy feedback: ${String(err)}`);
    }

    window.setTimeout(() => setCopyStatus(""), 3000);
  }

  function addLineComment() {
    const activeSelection = selection();
    if (!activeSelection || !commentInstruction().trim()) {
      return;
    }

    const snippet = buildContextSnippet(
      activeSelection.filePath,
      activeSelection.side,
      activeSelection.lineStart,
      activeSelection.lineEnd,
    );
    const fingerprint = fnv1aHex(normalizeForHash(snippet));

    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random()}`;

    const lineComment: LineComment = {
      id,
      file_path: activeSelection.filePath,
      side: activeSelection.side,
      line_start: activeSelection.lineStart,
      line_end:
        activeSelection.lineEnd > activeSelection.lineStart
          ? activeSelection.lineEnd
          : undefined,
      severity: commentSeverity(),
      instruction: commentInstruction().trim(),
      code_context: snippet,
      context_fingerprint: fingerprint,
      hunk_header: activeSelection.hunkHeader,
    };

    setComments((existing) => [...existing, lineComment]);
    setSelection(null);
    resetCommentDraft();
  }

  async function jumpToComment(comment: LineComment) {
    if (selectedPath() !== comment.file_path) {
      await loadFileDiff(comment.file_path);
    }

    const targetKey = lineDomKey(comment.file_path, comment.side, comment.line_start);
    window.setTimeout(() => {
      const element = lineElementMap.get(targetKey);
      element?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 30);
  }

  async function loadFileDiff(filePath: string) {
    setSelectedPath(filePath);
    const diff = await invoke<FileDiff>("load_file_diff", { filePath });
    setSelectedDiff(diff);
    setScrollTop(0);
    if (diffContainerRef) {
      diffContainerRef.scrollTop = 0;
    }
    lineElementMap.clear();
  }

  async function loadReviewData() {
    setLoading(true);
    setError("");

    try {
      const reviewContext = await invoke<ReviewRequest>("get_context");
      const fileList = await invoke<FileDiff[]>("get_file_list");

      setContext(reviewContext);
      setFiles(fileList);

      if (fileList.length > 0) {
        await loadFileDiff(fileList[0].new_path);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function submitReview() {
    const currentContext = context();
    if (!currentContext) {
      return;
    }

    setSubmitting(true);
    setError("");

    try {
      const trimmedFeedback = generalFeedback().trim();
      const currentDecision = decision();

      const payload: ReviewResponse = {
        session_id: currentContext.session_id,
        timestamp: new Date().toISOString(),
        decision: currentDecision,
        general_feedback: trimmedFeedback,
        line_comments: comments(),
        suggested_prompt: undefined,
        question:
          currentDecision === "ask_question" ? trimmedFeedback || undefined : undefined,
        review_duration_ms: 0,
      };

      await invoke("submit_review", { response: payload });
    } catch (err) {
      setError(String(err));
      setSubmitting(false);
    }
  }

  async function cancelReview() {
    try {
      await invoke("cancel_review", {
        reason: "Review cancelled by user",
      });
    } catch (err) {
      setError(String(err));
    }
  }

  onMount(() => {
    void loadReviewData();
    setViewportHeight(diffContainerRef?.clientHeight ?? 420);

    const onResize = () => {
      setViewportHeight(diffContainerRef?.clientHeight ?? 420);
    };

    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  });

  createEffect(() => {
    const currentSelection = selection();
    if (!currentSelection) {
      return;
    }

    if (currentSelection.filePath !== selectedPath()) {
      setSelection(null);
    }
  });

  return (
    <main class="app-shell">
      <header class="topbar">
        <div>
          <h1>OpenCode Human Review</h1>
          <Show when={context()}>
            {(ctx) => (
              <p>
                Session {ctx().session_id} · Iteration {ctx().iteration}
              </p>
            )}
          </Show>
        </div>
        <div class="repo-meta">
          <Show when={context()}>
            {(ctx) => (
              <>
                <span>{ctx().base_ref}</span>
                <span>→</span>
                <span>{ctx().head_ref ?? "working tree"}</span>
              </>
            )}
          </Show>
        </div>
      </header>

      <Show when={!loading()} fallback={<section class="loading">Loading review data...</section>}>
        <section class="workspace">
          <aside class="file-sidebar">
            <h2>Files</h2>
            <div class="file-scroll">
              <For each={files()}>
                {(file) => (
                  <button
                    type="button"
                    class={`file-item ${selectedPath() === file.new_path ? "active" : ""}`}
                    onClick={() => void loadFileDiff(file.new_path)}
                  >
                    <div class="file-top">
                      <span class="status">{file.status}</span>
                      <span class="file-name">{file.new_path}</span>
                    </div>
                    <div class="file-bottom">
                      <span class="add">+{file.additions}</span>
                      <span class="del">-{file.deletions}</span>
                      <Show when={file.is_binary}>
                        <span class="binary">binary</span>
                      </Show>
                    </div>
                  </button>
                )}
              </For>
            </div>
          </aside>

          <section class="diff-panel">
            <Show when={selectedDiff()} fallback={<div class="empty">Select a file to review.</div>}>
              {(diff) => (
                <>
                  <div class="diff-header">
                    <h2>{diff().new_path}</h2>
                    <span>
                      +{diff().additions} / -{diff().deletions}
                    </span>
                  </div>

                  <Show when={!diff().is_binary} fallback={<div class="binary-empty">Binary file diff</div>}>
                    <div
                      class="diff-scroll"
                      ref={diffContainerRef}
                      onScroll={(event) => {
                        setScrollTop(event.currentTarget.scrollTop);
                        setViewportHeight(event.currentTarget.clientHeight);
                      }}
                    >
                      <div class="diff-virtual" style={{ height: `${visibleRange().totalHeight}px` }}>
                        <div
                          class="diff-window"
                          style={{ transform: `translateY(${visibleRange().offsetY}px)` }}
                        >
                          <For each={visibleRows()}>
                            {(entry) => {
                              if (entry.row.type === "header") {
                                return <div class="hunk-row">{entry.row.header}</div>;
                              }

                              const lineRow = entry.row;
                              return (
                                <button
                                  type="button"
                                  class={`line-row ${lineRow.kind}`}
                                  classList={{
                                    selected:
                                      !!selection() &&
                                      selection()?.filePath === lineRow.filePath &&
                                      (() => {
                                        const active = selection();
                                        if (!active) return false;
                                        const lineNumber =
                                          active.side === "new"
                                            ? lineRow.newLine
                                            : lineRow.oldLine;
                                        return (
                                          lineNumber !== undefined &&
                                          lineNumber >= active.lineStart &&
                                          lineNumber <= active.lineEnd
                                        );
                                      })(),
                                  }}
                                  onClick={(event) =>
                                    handleLineClick(lineRow, event.shiftKey)
                                  }
                                  ref={(element) => {
                                    if (lineRow.newLine !== undefined) {
                                      lineElementMap.set(
                                        lineDomKey(
                                          lineRow.filePath,
                                          "new",
                                          lineRow.newLine,
                                        ),
                                        element,
                                      );
                                    }
                                    if (lineRow.oldLine !== undefined) {
                                      lineElementMap.set(
                                        lineDomKey(
                                          lineRow.filePath,
                                          "old",
                                          lineRow.oldLine,
                                        ),
                                        element,
                                      );
                                    }
                                  }}
                                >
                                  <span class="line-no old">{lineRow.oldLine ?? ""}</span>
                                  <span class="line-no new">{lineRow.newLine ?? ""}</span>
                                  <span class="line-text">{lineRow.text || " "}</span>
                                </button>
                              );
                            }}
                          </For>
                        </div>
                      </div>
                    </div>
                  </Show>
                </>
              )}
            </Show>
          </section>

          <aside class="review-panel">
            <h2>Review</h2>

            <label class="guidance-field">
              General agent guidance
              <textarea
                rows={5}
                value={generalFeedback()}
                onInput={(event) => setGeneralFeedback(event.currentTarget.value)}
                placeholder={
                  decision() === "ask_question"
                    ? "Blocking question for the agent"
                    : "High-level guidance for the agent"
                }
              />
            </label>

            <div class="line-review-section">
              <label class="decision-field">
                Decision
                <select
                  class="decision-select"
                  value={decision()}
                  onInput={(event) =>
                    setDecision(event.currentTarget.value as ReviewDecision)
                  }
                >
                  <option value="request_changes">Suggestion</option>
                  <option value="approve">Nitpick</option>
                  <option value="reject">Critical</option>
                  <option value="ask_question">Question</option>
                </select>
              </label>

              <section class="comment-builder">
                <h3>Line comments</h3>
                <Show when={selection()} fallback={<p>Select a diff line to comment.</p>}>
                  {(active) => (
                    <div class="selection-details">
                      <p>
                        {active().filePath} · {active().side} · {active().lineStart}
                        <Show when={active().lineEnd > active().lineStart}>
                          {(lineEnd) => <>-{lineEnd()}</>}
                        </Show>
                      </p>
                      <label>
                        Severity
                        <select
                          value={commentSeverity()}
                          onInput={(event) =>
                            setCommentSeverity(
                              event.currentTarget.value as CommentSeverity,
                            )
                          }
                        >
                          <option value="suggestion">Suggestion</option>
                          <option value="nitpick">Nitpick</option>
                          <option value="critical">Critical</option>
                          <option value="question">Question</option>
                        </select>
                      </label>
                      <label>
                        Instruction
                        <textarea
                          rows={3}
                          value={commentInstruction()}
                          onInput={(event) =>
                            setCommentInstruction(event.currentTarget.value)
                          }
                          placeholder="Actionable change request"
                        />
                      </label>
                      <button type="button" class="secondary" onClick={addLineComment}>
                        Add comment
                      </button>
                    </div>
                  )}
                </Show>

                <div class="comment-list">
                  <For each={comments()}>
                    {(comment) => (
                      <button
                        type="button"
                        class="comment-item"
                        onClick={() => void jumpToComment(comment)}
                      >
                        <strong>{comment.severity}</strong>
                        <span>
                          {comment.file_path}:{comment.line_start}
                          <Show when={comment.line_end}>
                            {(lineEnd) => <>-{lineEnd()}</>}
                          </Show>
                        </span>
                        <p>{comment.instruction}</p>
                      </button>
                    )}
                  </For>
                </div>
              </section>

              <div class="review-footer">
                <div class="actions">
                  <button
                    type="button"
                    class="secondary compact-button"
                    onClick={() => void copyAllFeedback()}
                  >
                    Copy to clipboard
                  </button>
                  <button
                    type="button"
                    class="secondary compact-button"
                    onClick={() => void cancelReview()}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    class="primary compact-button"
                    disabled={submitting()}
                    onClick={() => void submitReview()}
                  >
                    {submitting() ? "Submitting..." : "Submit Review"}
                  </button>
                </div>

                <Show when={copyStatus()}>
                  {(statusMessage) => (
                    <p
                      class="copy-status"
                      classList={{ error: statusMessage().startsWith("Unable") }}
                    >
                      {statusMessage()}
                    </p>
                  )}
                </Show>

                <Show when={error()}>
                  {(message) => <p class="error">{message()}</p>}
                </Show>
              </div>
            </div>
          </aside>
        </section>
      </Show>
    </main>
  );
}

export default App;
