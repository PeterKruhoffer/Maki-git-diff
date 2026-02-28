import { For, Show, type Accessor } from "solid-js";
import type { FileDiff } from "../types";

interface FileSidebarProps {
  files: Accessor<FileDiff[]>;
  selectedPath: Accessor<string>;
  onSelectFile: (filePath: string) => void | Promise<void>;
}

export function FileSidebar(props: FileSidebarProps) {
  return (
    <aside class="file-sidebar">
      <h2>Files</h2>
      <div class="file-scroll">
        <For each={props.files()}>
          {(file) => (
            <button
              type="button"
              class={`file-item ${props.selectedPath() === file.new_path ? "active" : ""}`}
              onClick={() => void props.onSelectFile(file.new_path)}
            >
              <div class="file-top">
                <span class="status">{file.status}</span>
                <span class="file-name">{file.new_path}</span>
              </div>
              <div class="file-bottom">
                <span class="add">+{file.additions}</span>
                <span class="del">-{file.deletions}</span>
                <Show when={file.is_binary}>
                  <span class="binary">binary</span>
                </Show>
              </div>
            </button>
          )}
        </For>
      </div>
    </aside>
  );
}
