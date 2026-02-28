import { For, Show, type Accessor } from "solid-js";
import type { DiffLineRow, DiffRow, FileDiff, LineSelection } from "../types";

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
                          <button
                            type="button"
                            class={`line-row ${row.kind}`}
                            classList={{ selected: isLineSelected(row) }}
                            onClick={(event) => props.onLineClick(row, event.shiftKey)}
                            ref={(element) => props.registerLineElement(row, element)}
                          >
                            <span class="line-no old">{row.oldLine ?? ""}</span>
                            <span class="line-no new">{row.newLine ?? ""}</span>
                            <span class="line-text">{row.text || " "}</span>
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
  );
}
