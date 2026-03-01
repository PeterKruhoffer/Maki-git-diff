import { invoke } from "@tauri-apps/api/core";
import {
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import "./App.css";
import { DiffPanel } from "./review/components/DiffPanel";
import { FileSidebar } from "./review/components/FileSidebar";
import { ReviewPanel } from "./review/components/ReviewPanel";
import { TopBar } from "./review/components/TopBar";
import type {
  CommentAnchor,
  CommentSeverity,
  DiffLineRow,
  DiffRow,
  DraftLineComment,
  FileDiff,
  FileDiffSummary,
  LineComment,
  LineSelection,
  ReviewDecision,
  ReviewRequest,
  ReviewResponse,
} from "./review/types";
import {
  ROW_HEIGHT,
  buildContextFingerprint,
  buildContextSnippet,
  buildDiffRows,
  buildFeedbackExport,
  deriveSelectionTarget,
  lineDomKey,
} from "./review/utils";

function App() {
  const AUTO_REFRESH_INTERVAL_MS = 2000;

  function isSameFileSummary(left: FileDiffSummary, right: FileDiffSummary) {
    return (
      left.old_path === right.old_path &&
      left.new_path === right.new_path &&
      left.status === right.status &&
      left.additions === right.additions &&
      left.deletions === right.deletions &&
      left.is_binary === right.is_binary
    );
  }

  function areFileSummariesEqual(left: FileDiffSummary[], right: FileDiffSummary[]) {
    if (left.length !== right.length) {
      return false;
    }

    for (let index = 0; index < left.length; index += 1) {
      if (!isSameFileSummary(left[index], right[index])) {
        return false;
      }
    }

    return true;
  }

  function areFileDiffsEqual(left: FileDiff, right: FileDiff) {
    if (!isSameFileSummary(left, right)) {
      return false;
    }

    const leftHunks = left.hunks ?? [];
    const rightHunks = right.hunks ?? [];
    if (leftHunks.length !== rightHunks.length) {
      return false;
    }

    for (let hunkIndex = 0; hunkIndex < leftHunks.length; hunkIndex += 1) {
      const leftHunk = leftHunks[hunkIndex];
      const rightHunk = rightHunks[hunkIndex];

      if (leftHunk.header !== rightHunk.header || leftHunk.lines.length !== rightHunk.lines.length) {
        return false;
      }

      for (let lineIndex = 0; lineIndex < leftHunk.lines.length; lineIndex += 1) {
        const leftLine = leftHunk.lines[lineIndex];
        const rightLine = rightHunk.lines[lineIndex];

        if (
          leftLine.kind !== rightLine.kind ||
          leftLine.old_line !== rightLine.old_line ||
          leftLine.new_line !== rightLine.new_line ||
          leftLine.text !== rightLine.text
        ) {
          return false;
        }
      }
    }

    return true;
  }

  const [context, setContext] = createSignal<ReviewRequest | null>(null);
  const [files, setFiles] = createSignal<FileDiffSummary[]>([]);
  const [selectedDiff, setSelectedDiff] = createSignal<FileDiff | null>(null);
  const [error, setError] = createSignal("");
  const [loading, setLoading] = createSignal(true);

  const [decision, setDecision] = createSignal<ReviewDecision>("request_changes");
  const [generalFeedback, setGeneralFeedback] = createSignal("");

  const [comments, setComments] = createSignal<DraftLineComment[]>([]);
  const [selection, setSelection] = createSignal<LineSelection | null>(null);
  const [commentAnchor, setCommentAnchor] = createSignal<CommentAnchor | null>(null);
  const [commentSeverity, setCommentSeverity] =
    createSignal<CommentSeverity>("suggestion");
  const [commentInstruction, setCommentInstruction] = createSignal("");
  const [submitting, setSubmitting] = createSignal(false);
  const [copyStatus, setCopyStatus] = createSignal("");

  const [scrollTop, setScrollTop] = createSignal(0);
  const [viewportHeight, setViewportHeight] = createSignal(420);
  const selectedPath = createMemo(() => selectedDiff()?.new_path ?? "");

  let diffContainerRef: HTMLDivElement | undefined;
  const lineElementMap = new Map<string, HTMLButtonElement>();
  let refreshInFlight = false;

  const diffRows = createMemo(() => buildDiffRows(selectedDiff()));

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
    return diffRows().slice(range.start, range.end);
  });

  function resetCommentDraft() {
    setCommentInstruction("");
    setCommentSeverity("suggestion");
  }

  function isCommentOutdated(comment: LineComment, rows: DiffRow[]) {
    const snippet = buildContextSnippet(
      rows,
      comment.file_path,
      comment.side,
      comment.line_start,
      comment.line_end ?? comment.line_start,
    );

    if (!snippet) {
      return true;
    }

    return buildContextFingerprint(snippet) !== comment.context_fingerprint;
  }

  function updateOutdatedCommentsForFile(
    sourceComments: DraftLineComment[],
    filePath: string,
    rows: DiffRow[],
  ) {
    return sourceComments.map((comment) => {
      if (comment.file_path !== filePath) {
        return comment;
      }

      const nextOutdated = isCommentOutdated(comment, rows);
      if (comment.is_outdated === nextOutdated) {
        return comment;
      }

      return {
        ...comment,
        is_outdated: nextOutdated,
      };
    });
  }

  function toPayloadComment(comment: DraftLineComment): LineComment {
    const { is_outdated: _isOutdated, ...payloadComment } = comment;
    return payloadComment;
  }

  async function syncCommentOutdatedStates() {
    const currentComments = comments();
    if (currentComments.length === 0) {
      return currentComments;
    }

    const uniqueFilePaths = Array.from(new Set(currentComments.map((comment) => comment.file_path)));
    const rowsByPath = new Map<string, DiffRow[]>();

    const loaded: Array<[string, DiffRow[]]> = await Promise.all(
      uniqueFilePaths.map(async (filePath): Promise<[string, DiffRow[]]> => {
        try {
          const diff = await invoke<FileDiff>("load_file_diff", { filePath });
          return [filePath, buildDiffRows(diff)];
        } catch {
          return [filePath, []];
        }
      }),
    );

    loaded.forEach(([filePath, rows]) => {
      rowsByPath.set(filePath, rows);
    });

    const syncedComments = currentComments.map((comment) => {
      const rows = rowsByPath.get(comment.file_path) ?? [];
      const nextOutdated = isCommentOutdated(comment, rows);
      if (comment.is_outdated === nextOutdated) {
        return comment;
      }

      return {
        ...comment,
        is_outdated: nextOutdated,
      };
    });

    setComments(syncedComments);
    return syncedComments;
  }

  function setDiffContainerRef(element: HTMLDivElement) {
    diffContainerRef = element;
  }

  function handleDiffScroll(container: HTMLDivElement) {
    const totalHeight = diffRows().length * ROW_HEIGHT;
    const maxScrollTop = Math.max(0, totalHeight - container.clientHeight);
    const clampedScrollTop = Math.min(Math.max(0, container.scrollTop), maxScrollTop);

    setScrollTop(clampedScrollTop);
    setViewportHeight(container.clientHeight);
  }

  function registerLineElement(row: DiffLineRow, element: HTMLButtonElement) {
    if (row.newLine !== undefined) {
      lineElementMap.set(lineDomKey(row.filePath, "new", row.newLine), element);
    }
    if (row.oldLine !== undefined) {
      lineElementMap.set(lineDomKey(row.filePath, "old", row.oldLine), element);
    }
  }

  function handleLineClick(row: DiffLineRow, shiftKey: boolean) {
    const current = selection();
    const target = deriveSelectionTarget(row, current?.side);
    if (!target) {
      return;
    }

    setCommentAnchor({
      filePath: row.filePath,
      side: target.side,
      lineNumber: target.lineNumber,
    });

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

  function dismissLineCommentEditor() {
    setSelection(null);
    setCommentAnchor(null);
    resetCommentDraft();
  }

  async function copyTextToClipboard(value: string) {
    await invoke("copy_to_clipboard", { value });
  }

  async function copyAllFeedback() {
    try {
      const syncedComments = await syncCommentOutdatedStates();
      const activeComments = syncedComments
        .filter((comment) => !comment.is_outdated)
        .map(toPayloadComment);
      const outdatedCount = syncedComments.length - activeComments.length;

      const exportText = buildFeedbackExport({
        reviewContext: context(),
        generalFeedback: generalFeedback(),
        decision: decision(),
        comments: activeComments,
      });
      await copyTextToClipboard(exportText);
      setCopyStatus(
        outdatedCount > 0
          ? `Copied review feedback. Excluded ${outdatedCount} outdated comment${
              outdatedCount === 1 ? "" : "s"
            }.`
          : "Copied all review feedback to clipboard.",
      );
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
      diffRows(),
      activeSelection.filePath,
      activeSelection.side,
      activeSelection.lineStart,
      activeSelection.lineEnd,
    );
    const fingerprint = buildContextFingerprint(snippet);

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

    setComments((existing) => [...existing, { ...lineComment, is_outdated: false }]);
    setSelection(null);
    setCommentAnchor(null);
    resetCommentDraft();
  }

  function resolveComment(commentId: string) {
    setComments((existing) => existing.filter((comment) => comment.id !== commentId));
  }

  async function jumpToComment(comment: DraftLineComment) {
    if (selectedPath() !== comment.file_path) {
      await loadFileDiff(comment.file_path);
    }

    const targetKey = lineDomKey(comment.file_path, comment.side, comment.line_start);
    window.setTimeout(() => {
      const element = lineElementMap.get(targetKey);
      element?.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 30);
  }

  function clearDiffState() {
    setSelectedDiff(null);
    setSelection(null);
    setCommentAnchor(null);
    setScrollTop(0);
    lineElementMap.clear();

    if (diffContainerRef) {
      diffContainerRef.scrollTop = 0;
    }
  }

  async function loadFileDiff(
    filePath: string,
    options: { resetScroll?: boolean } = {},
  ) {
    const resetScroll = options.resetScroll ?? true;
    const diff = await invoke<FileDiff>("load_file_diff", { filePath });
    const container = diffContainerRef;
    const wasNearBottom =
      !resetScroll &&
      container !== undefined &&
      container.scrollHeight - container.clientHeight - container.scrollTop <= ROW_HEIGHT;

    const currentDiff = selectedDiff();
    if (
      currentDiff &&
      currentDiff.new_path === filePath &&
      !resetScroll &&
      areFileDiffsEqual(currentDiff, diff)
    ) {
      return;
    }

    setSelectedDiff(diff);
    setComments((existing) => updateOutdatedCommentsForFile(existing, filePath, buildDiffRows(diff)));

    if (resetScroll) {
      setScrollTop(0);
      if (diffContainerRef) {
        diffContainerRef.scrollTop = 0;
      }
    } else if (diffContainerRef) {
      if (wasNearBottom) {
        window.requestAnimationFrame(() => {
          const activeContainer = diffContainerRef;
          if (!activeContainer) {
            return;
          }

          const maxScrollTop = Math.max(
            0,
            activeContainer.scrollHeight - activeContainer.clientHeight,
          );
          activeContainer.scrollTop = maxScrollTop;
          setScrollTop(maxScrollTop);
          setViewportHeight(activeContainer.clientHeight);
        });
      } else {
        setScrollTop(diffContainerRef.scrollTop);
        setViewportHeight(diffContainerRef.clientHeight);
      }
    }

    lineElementMap.clear();
  }

  async function syncDiffState() {
    const fileList = await invoke<FileDiffSummary[]>("get_file_list");
    const fileListChanged = !areFileSummariesEqual(fileList, files());
    if (fileListChanged) {
      setFiles(fileList);
    }

    if (fileList.length === 0) {
      clearDiffState();
      return;
    }

    const currentPath = selectedPath();
    const nextPath = fileList.some((file) => file.new_path === currentPath)
      ? currentPath
      : fileList[0].new_path;
    const resetScroll = nextPath !== currentPath || !selectedDiff();

    await loadFileDiff(nextPath, {
      resetScroll,
    });
  }

  async function loadReviewData() {
    setLoading(true);
    setError("");

    try {
      const reviewContext = await invoke<ReviewRequest>("get_context");

      setContext(reviewContext);
      await syncDiffState();
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  async function refreshDiffState() {
    if (refreshInFlight || loading()) {
      return;
    }

    refreshInFlight = true;
    try {
      await syncDiffState();
      setError("");
    } catch (err) {
      setError(String(err));
    } finally {
      refreshInFlight = false;
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
      const syncedComments = await syncCommentOutdatedStates();
      const activeComments = syncedComments
        .filter((comment) => !comment.is_outdated)
        .map(toPayloadComment);

      const payload: ReviewResponse = {
        session_id: currentContext.session_id,
        timestamp: new Date().toISOString(),
        decision: currentDecision,
        general_feedback: trimmedFeedback,
        line_comments: activeComments,
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
    const refreshTimer = window.setInterval(() => {
      void refreshDiffState();
    }, AUTO_REFRESH_INTERVAL_MS);

    onCleanup(() => {
      window.removeEventListener("resize", onResize);
      window.clearInterval(refreshTimer);
    });
  });

  createEffect(() => {
    const currentSelection = selection();
    if (!currentSelection) {
      setCommentAnchor(null);
      return;
    }

    if (currentSelection.filePath !== selectedPath()) {
      setSelection(null);
      setCommentAnchor(null);
    }
  });

  return (
    <main class="app-shell">
      <TopBar context={context} />

      <Show when={!loading()} fallback={<section class="loading">Loading review data...</section>}>
        <section class="workspace">
          <FileSidebar
            files={files()}
            selectedPath={selectedPath()}
            onSelectFile={loadFileDiff}
          />

          <DiffPanel
            selectedDiff={selectedDiff}
            selection={selection}
            visibleRows={visibleRows}
            visibleTotalHeight={() => visibleRange().totalHeight}
            visibleOffsetY={() => visibleRange().offsetY}
            onDiffScroll={handleDiffScroll}
            setDiffContainerRef={setDiffContainerRef}
            onLineClick={handleLineClick}
            registerLineElement={registerLineElement}
            commentAnchor={commentAnchor}
            commentSeverity={commentSeverity}
            setCommentSeverity={setCommentSeverity}
            commentInstruction={commentInstruction}
            setCommentInstruction={setCommentInstruction}
            onAddLineComment={addLineComment}
            onDismissLineCommentEditor={dismissLineCommentEditor}
          />

          <ReviewPanel
            decision={decision()}
            setDecision={setDecision}
            generalFeedback={generalFeedback()}
            setGeneralFeedback={setGeneralFeedback}
            comments={comments()}
            onJumpToComment={jumpToComment}
            onResolveComment={resolveComment}
            submitting={submitting()}
            onCopyAllFeedback={copyAllFeedback}
            onCancelReview={cancelReview}
            onSubmitReview={submitReview}
            copyStatus={copyStatus()}
            error={error()}
          />
        </section>
      </Show>
    </main>
  );
}

export default App;
