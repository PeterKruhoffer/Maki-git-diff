import type { ReviewPanelProps } from "./props";
import { CommentList } from "./CommentList";
import { CommentSelectionEditor } from "./CommentSelectionEditor";

type LineCommentsSectionProps = Pick<
  ReviewPanelProps,
  | "selection"
  | "commentSeverity"
  | "setCommentSeverity"
  | "commentInstruction"
  | "setCommentInstruction"
  | "onAddLineComment"
  | "comments"
  | "onJumpToComment"
>;

export function LineCommentsSection(props: LineCommentsSectionProps) {
  return (
    <section class="comment-builder">
      <h3>Line comments</h3>
      <CommentSelectionEditor
        selection={props.selection}
        commentSeverity={props.commentSeverity}
        setCommentSeverity={props.setCommentSeverity}
        commentInstruction={props.commentInstruction}
        setCommentInstruction={props.setCommentInstruction}
        onAddLineComment={props.onAddLineComment}
      />
      <CommentList comments={props.comments} onJumpToComment={props.onJumpToComment} />
    </section>
  );
}
