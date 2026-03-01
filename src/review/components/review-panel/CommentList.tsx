import { For, Show } from "solid-js";
import type { ReviewPanelProps } from "./props";

type CommentListProps = Pick<
  ReviewPanelProps,
  "comments" | "onJumpToComment" | "onResolveComment"
>;

export function CommentList(props: CommentListProps) {
  return (
    <div class="comment-list">
      <For each={props.comments}>
        {(comment) => (
          <article
            class="comment-item"
            classList={{ outdated: comment.is_outdated }}
          >
            <button
              type="button"
              class="comment-main"
              onClick={() => void props.onJumpToComment(comment)}
            >
              <strong>{comment.severity}</strong>
              <span>
                {comment.file_path}:{comment.line_start}
                <Show when={comment.line_end}>{(lineEnd) => <>-{lineEnd()}</>}</Show>
              </span>
              <Show when={comment.is_outdated}>
                <span class="comment-outdated-badge">Outdated</span>
              </Show>
              <p>{comment.instruction}</p>
            </button>

            <button
              type="button"
              class="secondary compact-button comment-resolve"
              onClick={() => props.onResolveComment(comment.id)}
            >
              Resolve
            </button>
          </article>
        )}
      </For>
    </div>
  );
}
