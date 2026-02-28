import { DecisionField } from "./review-panel/DecisionField";
import { GeneralGuidanceField } from "./review-panel/GeneralGuidanceField";
import { LineCommentsSection } from "./review-panel/LineCommentsSection";
import type { ReviewPanelProps } from "./review-panel/props";
import { ReviewActions } from "./review-panel/ReviewActions";

export function ReviewPanel(props: ReviewPanelProps) {
  return (
    <aside class="review-panel">
      <h2>Review</h2>

      <GeneralGuidanceField
        decision={props.decision}
        generalFeedback={props.generalFeedback}
        setGeneralFeedback={props.setGeneralFeedback}
      />

      <div class="line-review-section">
        <DecisionField decision={props.decision} setDecision={props.setDecision} />

        <LineCommentsSection
          selection={props.selection}
          commentSeverity={props.commentSeverity}
          setCommentSeverity={props.setCommentSeverity}
          commentInstruction={props.commentInstruction}
          setCommentInstruction={props.setCommentInstruction}
          onAddLineComment={props.onAddLineComment}
          comments={props.comments}
          onJumpToComment={props.onJumpToComment}
        />

        <ReviewActions
          submitting={props.submitting}
          onCopyAllFeedback={props.onCopyAllFeedback}
          onCancelReview={props.onCancelReview}
          onSubmitReview={props.onSubmitReview}
          copyStatus={props.copyStatus}
          error={props.error}
        />
      </div>
    </aside>
  );
}
