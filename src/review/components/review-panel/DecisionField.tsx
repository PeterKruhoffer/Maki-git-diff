import type { ReviewDecision } from "../../types";
import type { ReviewPanelProps } from "./props";

type DecisionFieldProps = Pick<ReviewPanelProps, "decision" | "setDecision">;

export function DecisionField(props: DecisionFieldProps) {
  return (
    <label class="decision-field">
      Decision
      <span class="select-field">
        <select
          class="decision-select"
          value={props.decision}
          onInput={(event) => props.setDecision(event.currentTarget.value as ReviewDecision)}
        >
          <option value="request_changes">Suggestion</option>
          <option value="approve">Nitpick</option>
          <option value="reject">Critical</option>
          <option value="ask_question">Question</option>
        </select>
      </span>
    </label>
  );
}
