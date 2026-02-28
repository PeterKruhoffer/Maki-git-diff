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
          disabled={props.submitting()}
          onClick={() => void props.onSubmitReview()}
        >
          {props.submitting() ? "Submitting..." : "Submit Review"}
        </button>
      </div>

      <Show when={props.copyStatus()}>
        {(statusMessage) => (
          <p class="copy-status" classList={{ error: statusMessage().startsWith("Unable") }}>
            {statusMessage()}
          </p>
        )}
      </Show>

      <Show when={props.error()}>{(message) => <p class="error">{message()}</p>}</Show>
    </div>
  );
}
