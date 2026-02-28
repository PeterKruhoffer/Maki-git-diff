import { For, Show } from "solid-js";
import type { ReviewPanelProps } from "./props";

type CommentListProps = Pick<ReviewPanelProps, "comments" | "onJumpToComment">;

export function CommentList(props: CommentListProps) {
  return (
    <div class="comment-list">
      <For each={props.comments()}>
        {(comment) => (
          <button
            type="button"
            class="comment-item"
            onClick={() => void props.onJumpToComment(comment)}
          >
            <strong>{comment.severity}</strong>
            <span>
              {comment.file_path}:{comment.line_start}
              <Show when={comment.line_end}>{(lineEnd) => <>-{lineEnd()}</>}</Show>
            </span>
            <p>{comment.instruction}</p>
          </button>
        )}
      </For>
    </div>
  );
}
