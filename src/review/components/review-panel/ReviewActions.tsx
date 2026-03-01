import { Show } from "solid-js";
import type { ReviewPanelProps } from "./props";

type ReviewActionsProps = Pick<
  ReviewPanelProps,
  | "submitting"
  | "onCopyAllFeedback"
  | "onCancelReview"
  | "onSubmitReview"
  | "copyStatus"
  | "error"
>;

export function ReviewActions(props: ReviewActionsProps) {
  return (
    <div class="review-footer">
      <div class="actions">
        <button
          type="button"
          class="secondary compact-button"
          onClick={() => void props.onCopyAllFeedback()}
        >
          Copy to clipboard
        </button>
        <button
          type="button"
          class="secondary compact-button"
          onClick={() => void props.onCancelReview()}
        >
          Cancel
        </button>
        <button
          type="button"
          class="primary compact-button"
          disabled={props.submitting}
          onClick={() => void props.onSubmitReview()}
        >
          {props.submitting ? "Submitting..." : "Submit Review"}
        </button>
      </div>

      <Show when={props.copyStatus}>
        <p class="copy-status" classList={{ error: props.copyStatus.startsWith("Unable") }}>
          {props.copyStatus}
        </p>
      </Show>

      <Show when={props.error}>
        <p class="error">{props.error}</p>
      </Show>
    </div>
  );
}
