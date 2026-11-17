/** VS Code and VS Code-based editors share the same layout, so one definition each is enough. */
export interface EditorDef {
  id: string;
  name: string;
  /** CLI used to list/install extensions. */
  cli: string;
  /** Folder name under the config root: <appData>/<dirName>/User */
  dirName: string;
}

export const EDITORS: EditorDef[] = [
  { id: "vscode", name: "VS Code", cli: "code", dirName: "Code" },
  { id: "antigravity", name: "Antigravity", cli: "antigravity", dirName: "Antigravity" },
];

/** Files and folders inside the User folder worth carrying over. */
export const EDITOR_FILES = ["settings.json", "keybindings.json", "tasks.json"];
export const EDITOR_DIRS = ["snippets"];
