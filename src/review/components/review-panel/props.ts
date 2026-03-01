import type {
  DraftLineComment,
  ReviewDecision,
} from "../../types";

export interface ReviewPanelProps {
  decision: ReviewDecision;
  setDecision: (value: ReviewDecision) => void;
  generalFeedback: string;
  setGeneralFeedback: (value: string) => void;
  comments: DraftLineComment[];
  onJumpToComment: (comment: DraftLineComment) => void | Promise<void>;
  onResolveComment: (commentId: string) => void;
  submitting: boolean;
  onCopyAllFeedback: () => void | Promise<void>;
  onCancelReview: () => void | Promise<void>;
  onSubmitReview: () => void | Promise<void>;
  copyStatus: string;
  error: string;
}
