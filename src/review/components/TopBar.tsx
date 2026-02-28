import { Show, type Accessor } from "solid-js";
import type { ReviewRequest } from "../types";

interface TopBarProps {
  context: Accessor<ReviewRequest | null>;
}

export function TopBar(props: TopBarProps) {
  return (
    <header class="topbar">
      <div>
        <h1>OpenCode Human Review</h1>
        <Show when={props.context()}>
          {(ctx) => (
            <p>
              Session {ctx().session_id} · Iteration {ctx().iteration}
            </p>
          )}
        </Show>
      </div>
      <div class="repo-meta">
        <Show when={props.context()}>
          {(ctx) => (
            <>
              <span>{ctx().base_ref}</span>
              <span>→</span>
              <span>{ctx().head_ref ?? "working tree"}</span>
            </>
          )}
        </Show>
      </div>
    </header>
  );
}
