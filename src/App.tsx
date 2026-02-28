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
  CommentSeverity,
  DiffLineRow,
  FileDiff,
  LineComment,
  LineSelection,
  ReviewDecision,
  ReviewRequest,
  ReviewResponse,
} from "./review/types";
import {
  ROW_HEIGHT,
  buildContextSnippet,
  buildDiffRows,
  buildFeedbackExport,
  deriveSelectionTarget,
  fnv1aHex,
  lineDomKey,
  normalizeForHash,
} from "./review/utils";

function App() {
  const AUTO_REFRESH_INTERVAL_MS = 2000;

  const [context, setContext] = createSignal<ReviewRequest | null>(null);
  const [files, setFiles] = createSignal<FileDiff[]>([]);
  const [selectedDiff, setSelectedDiff] = createSignal<FileDiff | null>(null);
  const [error, setError] = createSignal("");
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

  function setDiffContainerRef(element: HTMLDivElement) {
    diffContainerRef = element;
  }

  function handleDiffScroll(container: HTMLDivElement) {
    setScrollTop(container.scrollTop);
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
      const exportText = buildFeedbackExport({
        reviewContext: context(),
        generalFeedback: generalFeedback(),
        decision: decision(),
        comments: comments(),
      });
      await copyTextToClipboard(exportText);
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
      diffRows(),
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

  function clearDiffState() {
    setSelectedDiff(null);
    setSelection(null);
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
    setSelectedDiff(diff);

    if (resetScroll) {
      setScrollTop(0);
      if (diffContainerRef) {
        diffContainerRef.scrollTop = 0;
      }
    } else if (diffContainerRef) {
      setScrollTop(diffContainerRef.scrollTop);
      setViewportHeight(diffContainerRef.clientHeight);
    }

    lineElementMap.clear();
  }

  async function syncDiffState() {
    const fileList = await invoke<FileDiff[]>("get_file_list");
    setFiles(fileList);

    if (fileList.length === 0) {
      clearDiffState();
      return;
    }

    const currentPath = selectedPath();
    const nextPath = fileList.some((file) => file.new_path === currentPath)
      ? currentPath
      : fileList[0].new_path;

    await loadFileDiff(nextPath, {
      resetScroll: nextPath !== currentPath || !selectedDiff(),
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
      return;
    }

    if (currentSelection.filePath !== selectedPath()) {
      setSelection(null);
    }
  });

  return (
    <main class="app-shell">
      <TopBar context={context} />

      <Show when={!loading()} fallback={<section class="loading">Loading review data...</section>}>
        <section class="workspace">
          <FileSidebar
            files={files}
            selectedPath={selectedPath}
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
          />

          <ReviewPanel
            decision={decision}
            setDecision={setDecision}
            generalFeedback={generalFeedback}
            setGeneralFeedback={setGeneralFeedback}
            selection={selection}
            commentSeverity={commentSeverity}
            setCommentSeverity={setCommentSeverity}
            commentInstruction={commentInstruction}
            setCommentInstruction={setCommentInstruction}
            comments={comments}
            onAddLineComment={addLineComment}
            onJumpToComment={jumpToComment}
            submitting={submitting}
            onCopyAllFeedback={copyAllFeedback}
            onCancelReview={cancelReview}
            onSubmitReview={submitReview}
            copyStatus={copyStatus}
            error={error}
          />
        </section>
      </Show>
    </main>
  );
}

export default App;
