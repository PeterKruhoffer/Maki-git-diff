import { Show } from "solid-js";
import type { CommentSeverity } from "../../types";
import type { ReviewPanelProps } from "./props";

type CommentSelectionEditorProps = Pick<
  ReviewPanelProps,
  | "selection"
  | "commentSeverity"
  | "setCommentSeverity"
  | "commentInstruction"
  | "setCommentInstruction"
  | "onAddLineComment"
>;

export function CommentSelectionEditor(props: CommentSelectionEditorProps) {
  return (
    <Show when={props.selection()} fallback={<p>Select a diff line to comment.</p>}>
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
              value={props.commentSeverity()}
              onInput={(event) =>
                props.setCommentSeverity(event.currentTarget.value as CommentSeverity)
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
              onInput={(event) => props.setCommentInstruction(event.currentTarget.value)}
              placeholder="Actionable change request"
            />
          </label>
          <button type="button" class="secondary" onClick={props.onAddLineComment}>
            Add comment
          </button>
        </div>
      )}
    </Show>
  );
}
