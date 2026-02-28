import type { ReviewPanelProps } from "./props";

type GeneralGuidanceFieldProps = Pick<
  ReviewPanelProps,
  "decision" | "generalFeedback" | "setGeneralFeedback"
>;

export function GeneralGuidanceField(props: GeneralGuidanceFieldProps) {
  return (
    <label class="guidance-field">
      General agent guidance
      <textarea
        rows={5}
        value={props.generalFeedback()}
        onInput={(event) => props.setGeneralFeedback(event.currentTarget.value)}
        placeholder={
          props.decision() === "ask_question"
            ? "Blocking question for the agent"
            : "High-level guidance for the agent"
        }
      />
    </label>
  );
}
