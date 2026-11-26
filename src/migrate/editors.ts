import type { RunResult, Runner } from "../utils/run.js";
import { c, type Logger } from "../utils/logger.js";

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

// ── Installing extensions ────────────────────────────────────

/** Seconds to wait before trying failed extensions again (the marketplace limits fast downloads). */
export const EXTENSION_RETRY_MS = 10_000;

const NOISE = /DeprecationWarning|--trace-deprecation|^Installing extensions?\b/i;

/** The useful line of a failed `code --install-extension`, without Node's warnings. */
export function extensionError(r: RunResult): string {
  for (const text of [r.stderr, r.stdout]) {
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !NOISE.test(l));
    if (lines.length) return lines[lines.length - 1];
  }
  return r.error ?? `exit code ${r.code}`;
}

export interface ExtensionInstall {
  runner: Runner;
  log: Logger;
  /** Pass --force (restore: take the backup's version). */
  force?: boolean;
  /** Restoring from another OS: some extensions only exist for one OS. */
  otherOs?: string;
  /** Waits before the retry; tests pass one that doesn't. */
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Install extensions one by one. Anything that fails is tried once more after
 * a pause, since failures are usually the marketplace limiting downloads or a
 * network blip. Returns what still failed, with the editor's own message.
 */
export async function installExtensions(cli: string, exts: string[], o: ExtensionInstall): Promise<{ ext: string; reason: string }[]> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const args = (ext: string) => ["--install-extension", ext, ...(o.force ? ["--force"] : [])];

  let failed: { ext: string; reason: string }[] = [];
  for (const ext of exts) {
    const r = o.runner.run(cli, args(ext));
    if (r.ok) o.log.ok(ext);
    else failed.push({ ext, reason: extensionError(r) });
  }
  if (!failed.length) return [];

  o.log.info(c.dim(`  ${failed.length} didn't install. Trying again in ${EXTENSION_RETRY_MS / 1000} seconds…`));
  await sleep(EXTENSION_RETRY_MS);
  const retry = failed;
  failed = [];
  for (const { ext } of retry) {
    const r = o.runner.run(cli, args(ext));
    if (r.ok) { o.log.ok(ext); continue; }
    const reason = extensionError(r);
    failed.push({ ext, reason });
    o.log.warn(`${ext}: could not install: ${reason}${o.otherOs ? ` (it may not exist for ${o.otherOs})` : ""}`);
  }
  return failed;
}
