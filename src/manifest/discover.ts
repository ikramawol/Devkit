import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Runner } from "../utils/run.js";
import { isWindowsSidePath, type PlatformInfo } from "../core/platform.js";
import { redactJson, redactShell } from "../migrate/bundle.js";

/**
 * Small readers that look at this machine without changing it.
 * Shared by `dkit scan` (the manifest) and `dkit migrate export` (the backup).
 */

// Both must start with a letter/digit, so a value can never be read as a command-line option (-g, --prefix).
export const EXTENSION_ID = /^\w[\w-]*\.[\w.-]+$/;
export const NPM_NAME = /^(@[\w.-]+\/)?\w[\w.-]*$/;

/** Extension ids of a VS Code-style editor, or null if its CLI isn't on PATH. */
export function listExtensions(runner: Runner, cli: string): string[] | null {
  if (!runner.which(cli)) return null;
  return runner.run(cli, ["--list-extensions"]).stdout
    .split(/\r?\n/).map((s) => s.trim()).filter((s) => EXTENSION_ID.test(s));
}

/**
 * Names of global npm packages (minus npm itself and corepack), or null if there is no usable npm.
 * In WSL, Windows' npm (/mnt/c/...) lists Windows packages, so it doesn't count.
 */
export function listNpmGlobals(runner: Runner, platform?: PlatformInfo): string[] | null {
  const npm = runner.which("npm");
  if (!npm || (platform?.wsl && isWindowsSidePath(npm))) return null;
  const r = runner.run("npm", ["ls", "-g", "--depth=0", "--json"]);
  try {
    return Object.keys(JSON.parse(r.stdout).dependencies ?? {}).filter((n) => !["npm", "corepack"].includes(n));
  } catch {
    return []; // npm is there but printed nothing readable: treat it as no packages
  }
}

// ── Git ──────────────────────────────────────────────────────

/** Keys that hold secrets or machine-specific helpers. Never copied anywhere. */
export const SKIP_GIT_KEY = /^(credential\.|http\..*extraheader|.*(token|password))/i;

/** Keys that identify you or point at your folders: left out of a manifest (a backup keeps them). */
const PERSONAL_GIT_KEY = /^(user\.|core\.excludesfile$|includeif\.|include\.path$|safe\.directory$|sendemail\.|github\.user$|gpg\.|commit\.template$)/i;
const LOOKS_LIKE_PATH = /^(~|\/|[A-Za-z]:[\\/])|[\\/](Users|home)[\\/]/;

/**
 * Preferences dkit sets for you from a manifest. They change how Git behaves, but can't run anything.
 * Every other key (aliases, core.editor, core.sshCommand, hooks...) can start a program, so a
 * manifest from someone else could run code through it: those are shown, never applied.
 */
export const SAFE_GIT_KEYS = new Set([
  "init.defaultbranch", "pull.rebase", "pull.ff", "push.default", "push.autosetupremote", "push.followtags",
  "fetch.prune", "fetch.prunetags", "rebase.autostash", "rebase.autosquash", "rebase.updaterefs",
  "merge.conflictstyle", "merge.ff", "diff.algorithm", "diff.colormoved", "diff.renames", "core.autocrlf",
  "core.eol", "core.longpaths", "core.ignorecase", "core.whitespace", "color.ui", "help.autocorrect",
  "rerere.enabled", "branch.sort", "tag.sort", "column.ui", "commit.verbose", "status.showuntrackedfiles",
  "log.date", "submodule.recurse",
]);

/** Whether dkit may set this Git setting from a manifest: an allowed preference, or an alias that doesn't run a shell (`!...`). */
export function isSafeGitSetting(key: string, value: string): boolean {
  if (value.startsWith("-")) return false;
  const k = key.toLowerCase();
  return SAFE_GIT_KEYS.has(k) || (/^alias\.[\w-]+$/.test(k) && !value.trimStart().startsWith("!"));
}

/** Every global Git setting except secrets, as git prints them (key=value, keys can repeat). */
export function readGitConfig(runner: Runner): [string, string][] | null {
  if (!runner.which("git")) return null;
  const out: [string, string][] = [];
  for (const line of runner.run("git", ["config", "--global", "--list"]).stdout.split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i <= 0) continue;
    const key = line.slice(0, i);
    if (!SKIP_GIT_KEY.test(key)) out.push([key, line.slice(i + 1)]);
  }
  return out;
}

/** Git settings fit to share: no identity, no folder paths. Keys are lower-cased like git's own. */
export function shareableGit(config: [string, string][]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [k, v] of config) {
    const key = k.toLowerCase();
    if (PERSONAL_GIT_KEY.test(key) || LOOKS_LIKE_PATH.test(v)) continue;
    (out[key] ??= []).push(v);
  }
  return out;
}

// ── Shell profiles ───────────────────────────────────────────

export type ShellKind = "powershell" | "bash" | "zsh";

export function shellProfiles(platform: PlatformInfo): { kind: ShellKind; file: string }[] {
  const candidates: [ShellKind, string][] =
    platform.os === "windows"
      ? [
          ["powershell", path.join(platform.home, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1")],
          ["powershell", path.join(platform.home, "Documents", "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1")],
        ]
      : [["bash", path.join(platform.home, ".bashrc")], ["zsh", path.join(platform.home, ".zshrc")]];
  return candidates.filter(([, f]) => existsSync(f)).map(([kind, file]) => ({ kind, file }));
}

// ── Secret references ────────────────────────────────────────

/** A secret your setup relies on. Only its name is ever recorded, never the value. */
export interface SecretRef {
  name: string;
  /** Where it was found, in words: "PowerShell profile", "Claude Code MCP server github". */
  where: string;
  /** "env" secrets are environment variables, so dkit can tell whether they're set. */
  kind: "env" | "config";
}

const SHELL_LABEL: Record<ShellKind, string> = { powershell: "PowerShell profile", bash: ".bashrc", zsh: ".zshrc" };

function readJson(file: string): unknown {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return undefined; }
}

/** Names of the secrets set in shell profiles and Claude Code config, found with the same rules export uses to remove them. */
export function findSecretRefs(platform: PlatformInfo): SecretRef[] {
  const refs: SecretRef[] = [];
  for (const { kind, file } of shellProfiles(platform)) {
    const { redacted } = redactShell(readFileSync(file, "utf8"));
    // "token" means a bare token value with no variable name: nothing to refer to.
    for (const name of redacted) if (name !== "token") refs.push({ name, where: SHELL_LABEL[kind], kind: "env" });
  }
  const settings = readJson(path.join(platform.home, ".claude", "settings.json")) as { env?: unknown } | undefined;
  if (settings?.env) {
    for (const p of redactJson(settings.env).redacted) refs.push({ name: p, where: "Claude Code settings (env)", kind: "config" });
  }
  const cfg = readJson(path.join(platform.home, ".claude.json")) as { mcpServers?: Record<string, unknown> } | undefined;
  for (const [server, def] of Object.entries(cfg?.mcpServers ?? {})) {
    for (const p of redactJson(def).redacted) refs.push({ name: p.split(".").pop()!, where: `Claude Code MCP server "${server}"`, kind: "config" });
  }
  const seen = new Set<string>();
  return refs.filter((r) => !seen.has(`${r.name}|${r.where}`) && seen.add(`${r.name}|${r.where}`));
}
