import { For, Show, type Accessor } from "solid-js";
import type {
  CommentAnchor,
  CommentSeverity,
  DiffLineRow,
  DiffRow,
  FileDiff,
  LineSelection,
} from "../types";

interface DiffPanelProps {
  selectedDiff: Accessor<FileDiff | null>;
  selection: Accessor<LineSelection | null>;
  visibleRows: Accessor<DiffRow[]>;
  visibleTotalHeight: Accessor<number>;
  visibleOffsetY: Accessor<number>;
  onDiffScroll: (container: HTMLDivElement) => void;
  setDiffContainerRef: (element: HTMLDivElement) => void;
  onLineClick: (row: DiffLineRow, shiftKey: boolean) => void;
  registerLineElement: (row: DiffLineRow, element: HTMLButtonElement) => void;
  commentAnchor: Accessor<CommentAnchor | null>;
  commentSeverity: Accessor<CommentSeverity>;
  setCommentSeverity: (value: CommentSeverity) => void;
  commentInstruction: Accessor<string>;
  setCommentInstruction: (value: string) => void;
  onAddLineComment: () => void;
  onDismissLineCommentEditor: () => void;
}

export function DiffPanel(props: DiffPanelProps) {
  const isLineSelected = (lineRow: DiffLineRow) => {
    const active = props.selection();
    if (!active || active.filePath !== lineRow.filePath) {
      return false;
    }

    const lineNumber = active.side === "new" ? lineRow.newLine : lineRow.oldLine;
    return (
      lineNumber !== undefined &&
      lineNumber >= active.lineStart &&
      lineNumber <= active.lineEnd
    );
  };

  const isAnchorLine = (lineRow: DiffLineRow) => {
    const anchor = props.commentAnchor();
    if (!anchor || anchor.filePath !== lineRow.filePath) {
      return false;
    }

    const lineNumber = anchor.side === "new" ? lineRow.newLine : lineRow.oldLine;
    return lineNumber === anchor.lineNumber;
  };

  return (
    <section class="diff-panel">
      <Show when={props.selectedDiff()} fallback={<div class="empty">Select a file to review.</div>}>
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
                ref={(element) => props.setDiffContainerRef(element)}
                onScroll={(event) => props.onDiffScroll(event.currentTarget)}
              >
                <div class="diff-virtual" style={{ height: `${props.visibleTotalHeight()}px` }}>
                  <div
                    class="diff-window"
                    style={{ transform: `translateY(${props.visibleOffsetY()}px)` }}
                  >
                    <For each={props.visibleRows()}>
                      {(row) => {
                        if (row.type === "header") {
                          return <div class="hunk-row">{row.header}</div>;
                        }

                        return (
                          <div class="line-entry">
                            <button
                              type="button"
                              class={`line-row ${row.kind}`}
                              classList={{
                                selected: isLineSelected(row),
                                "comment-anchor": isAnchorLine(row),
                              }}
                              onClick={(event) => props.onLineClick(row, event.shiftKey)}
                              ref={(element) => props.registerLineElement(row, element)}
                            >
                              <span class="line-no old">{row.oldLine ?? ""}</span>
                              <span class="line-no new">{row.newLine ?? ""}</span>
                              <span class="line-text">{row.text || " "}</span>
                            </button>

                            <Show when={isAnchorLine(row)}>
                              <Show when={props.selection()}>
                                {(active) => (
                                  <div class="line-comment-popover" role="dialog" aria-modal="false">
                                    <p class="line-comment-meta">
                                      {active().filePath} · {active().side} · {active().lineStart}
                                      <Show when={active().lineEnd > active().lineStart}>
                                        {(lineEnd) => <>-{lineEnd()}</>}
                                      </Show>
                                    </p>

                                    <label>
                                      Severity
                                      <select
                                        value={props.commentSeverity()}
                                        onInput={(event) =>
                                          props.setCommentSeverity(
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
                                        value={props.commentInstruction()}
                                        onInput={(event) =>
                                          props.setCommentInstruction(event.currentTarget.value)
                                        }
                                        onKeyDown={(event) => {
                                          if (event.key === "Escape") {
                                            props.onDismissLineCommentEditor();
                                          }
                                        }}
                                        placeholder="Actionable change request"
                                        autofocus
                                      />
                                    </label>

                                    <div class="line-comment-actions">
                                      <button
                                        type="button"
                                        class="secondary compact-button"
                                        onClick={props.onDismissLineCommentEditor}
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        type="button"
                                        class="primary compact-button"
                                        disabled={!props.commentInstruction().trim()}
                                        onClick={props.onAddLineComment}
                                      >
                                        Add comment
                                      </button>
                                    </div>
                                  </div>
                                )}
                              </Show>
                            </Show>
                          </div>
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
  );
}
