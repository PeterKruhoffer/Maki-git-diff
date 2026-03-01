import type { ReviewPanelProps } from "./props";
import { CommentList } from "./CommentList";

type LineCommentsSectionProps = Pick<
  ReviewPanelProps,
  "comments" | "onJumpToComment" | "onResolveComment"
>;

export function LineCommentsSection(props: LineCommentsSectionProps) {
  return (
    <section class="comment-builder">
      <h3>Line comments</h3>
      <CommentList
        comments={props.comments}
        onJumpToComment={props.onJumpToComment}
        onResolveComment={props.onResolveComment}
      />
    </section>
  );
}
