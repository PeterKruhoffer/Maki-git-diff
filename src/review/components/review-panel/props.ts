import type { Accessor } from "solid-js";
import type {
  CommentSeverity,
  LineComment,
  LineSelection,
  ReviewDecision,
} from "../../types";

export interface ReviewPanelProps {
  decision: Accessor<ReviewDecision>;
  setDecision: (value: ReviewDecision) => void;
  generalFeedback: Accessor<string>;
  setGeneralFeedback: (value: string) => void;
  selection: Accessor<LineSelection | null>;
  commentSeverity: Accessor<CommentSeverity>;
  setCommentSeverity: (value: CommentSeverity) => void;
  commentInstruction: Accessor<string>;
  setCommentInstruction: (value: string) => void;
  comments: Accessor<LineComment[]>;
  onAddLineComment: () => void;
  onJumpToComment: (comment: LineComment) => void | Promise<void>;
  submitting: Accessor<boolean>;
  onCopyAllFeedback: () => void | Promise<void>;
  onCancelReview: () => void | Promise<void>;
  onSubmitReview: () => void | Promise<void>;
  copyStatus: Accessor<string>;
  error: Accessor<string>;
}
