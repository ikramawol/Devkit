import { lstatSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { CATALOG } from "../core/catalog.js";
import { detectItem, type DetectDeps } from "../core/detect.js";
import { isWindowsSidePath, type OS } from "../core/platform.js";
import { checkUpdates, type UpdateInfo } from "./maintain.js";

/**
 * Read-only health check of the things that most often break a dev setup:
 * PATH folders that are gone or listed twice, two copies of the same tool, tools that are installed
 * but can't be found, and updates waiting. It never changes anything; it says what to do.
 */

export interface Finding {
  /** problem = likely to bite you; note = worth knowing. */
  level: "problem" | "note";
  title: string;
  lines?: string[];
  fix?: string;
}

export interface DiagnoseDeps extends DetectDeps {
  env?: Record<string, string | undefined>;
  /** A file is there (also true for Windows app-execution aliases, which can't be stat'ed). */
  isFile?: (p: string) => boolean;
  isDir?: (p: string) => boolean;
  realpath?: (p: string) => string;
}

const defaultIsFile = (p: string) => {
  try { return statSync(p).isFile(); } catch {
    try { return lstatSync(p).isSymbolicLink(); } catch { return false; } // WindowsApps aliases are reparse points
  }
};
const defaultIsDir = (p: string) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const defaultRealpath = (p: string) => { try { return realpathSync(p); } catch { return p; } };

/** PATH as a list of folders, in order (quotes removed, empty entries dropped). */
export function pathEntries(env: Record<string, string | undefined>, os: OS): string[] {
  const value = env.PATH ?? env.Path ?? env.path ?? "";
  return value.split(os === "windows" ? ";" : ":").map((p) => p.trim().replace(/^"(.*)"$/, "$1")).filter(Boolean);
}

/** Windows compares folders without case and ignores a trailing backslash. */
const folderKey = (p: string, os: OS) => (os === "windows" ? p.replace(/[\\/]+$/, "").toLowerCase() : p.replace(/\/+$/, "") || "/");

export function checkPathEntries(entries: string[], os: OS, isDir: (p: string) => boolean) {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const e of entries) {
    const k = folderKey(e, os);
    if (seen.has(k) && !duplicates.some((d) => folderKey(d, os) === k)) duplicates.push(e);
    seen.add(k);
  }
  const missing = [...new Set(entries)].filter((e) => !isDir(e));
  return { missing, duplicates };
}

/** Every copy of `command` on PATH, in the order the shell tries them (the first one runs). */
export function copiesOnPath(command: string, entries: string[], os: OS, deps: { isFile: (p: string) => boolean; realpath: (p: string) => string; env?: Record<string, string | undefined> }): string[] {
  const exts = os === "windows"
    ? (deps.env?.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").map((e) => e.toLowerCase()).filter((e) => [".com", ".exe", ".bat", ".cmd"].includes(e))
    : [""];
  const join = os === "windows" ? path.win32.join : path.posix.join;
  const copies: string[] = [];
  const real = new Set<string>();
  const dirs = new Set<string>();
  for (const dir of entries) {
    if (dirs.has(folderKey(dir, os))) continue; // the same folder listed twice isn't a second copy
    dirs.add(folderKey(dir, os));
    for (const ext of exts) {
      const file = join(dir, command + ext);
      if (!deps.isFile(file)) continue;
      const k = folderKey(deps.realpath(file), os); // /bin/git and /usr/bin/git are often the same file
      if (!real.has(k)) { real.add(k); copies.push(file); }
      break; // one per folder: npm's prettier, prettier.cmd and prettier.ps1 are one tool
    }
  }
  return copies;
}

const isStoreAlias = (p: string) => /[\\/]microsoft[\\/]windowsapps[\\/]/i.test(p);

export interface DiagnoseReport { findings: Finding[]; updates: UpdateInfo[]; updateErrors: string[]; checkedUpdates: boolean }

export function diagnose(deps: DiagnoseDeps, opts: { updates?: boolean } = {}): DiagnoseReport {
  const { runner, platform } = deps;
  const os = platform.os;
  const env = { ...(deps.env ?? process.env) };
  const isFile = deps.isFile ?? defaultIsFile;
  const isDir = deps.isDir ?? defaultIsDir;
  const realpath = deps.realpath ?? defaultRealpath;
  const findings: Finding[] = [];
  // On Windows, check the saved PATH (System + User): what new terminals start with, and what Settings edits.
  // The current one can include a shell's own additions (Git Bash adds its folders) that Settings can't fix.
  if (!deps.env && os === "windows") {
    const r = runner.powershell("[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')");
    if (r.ok && r.stdout.trim()) env.PATH = r.stdout.trim();
  }
  // In WSL, Windows folders (/mnt/c/...) are on PATH too; they aren't this Linux system's tools.
  const entries = pathEntries(env, os);
  const linuxEntries = platform.wsl ? entries.filter((e) => !isWindowsSidePath(e)) : entries;
  const onPath = (dir: string) => entries.some((e) => folderKey(e, os) === folderKey(dir, os));

  // 1. PATH itself.
  const { missing, duplicates } = checkPathEntries(linuxEntries, os, isDir);
  const pathHelp = os === "windows"
    ? "Edit it in Settings: search \"environment variables\" → Edit the system environment variables → Environment Variables → Path."
    : `Edit the PATH line in your shell profile (${os === "macos" ? "~/.zshrc" : "~/.bashrc"}).`;
  if (missing.length) findings.push({ level: "note", title: `${missing.length} folder(s) on PATH don't exist (usually left behind by an uninstalled app; harmless, but clutter)`, lines: missing, fix: pathHelp });
  if (duplicates.length) findings.push({ level: "note", title: `${duplicates.length} folder(s) are on PATH more than once`, lines: duplicates, fix: pathHelp });

  // 2. Tools: two copies, the Store's fake python, installed but not on PATH.
  for (const item of CATALOG.filter((i) => i.kind === "machine")) {
    const { commandOn } = item.detect;
    const command = item.detect.commandFor?.[os] ?? item.detect.command;
    if (!command || (commandOn && !commandOn.includes(os))) continue;

    const copies = copiesOnPath(command, linuxEntries, os, { isFile, realpath, env });
    if (os === "windows" && command === "python" && copies.length > 1 && isStoreAlias(copies[0])) {
      findings.push({
        level: "problem",
        title: "`python` opens the Microsoft Store instead of your Python",
        lines: copies.map((c, i) => `${c}${i === 0 ? "  ← runs (Store shortcut)" : ""}`),
        fix: "Settings → Apps → Advanced app settings → App execution aliases: turn off python.exe and python3.exe.",
      });
    } else if (copies.filter((c, i) => i === 0 || !isStoreAlias(c)).length > 1) {
      // A Store shortcut behind a real install never runs, so it doesn't count as a copy.
      const shown = copies.filter((c, i) => i === 0 || !isStoreAlias(c));
      findings.push({
        level: "note",
        title: `${item.name}: ${shown.length} copies of \`${command}\` on PATH. The first one runs`,
        lines: shown.map((c, i) => `${c}${i === 0 ? "  ← runs" : ""}`),
        fix: "Only a problem if the one that runs isn't the one you want: uninstall the other, or move its folder later in PATH.",
      });
    }

    const status = detectItem(item, deps);
    if (status.installed && !runner.which(command)) {
      const where = status.where && status.where !== "winget" ? status.where : undefined;
      const parse = os === "windows" ? path.win32.parse : path.posix.parse;
      // Found as the command itself (e.g. ~/.local/bin/claude): its folder is what PATH is missing.
      const isTheCommand = where && parse(where).name.toLowerCase() === command.toLowerCase();
      findings.push({
        level: "problem",
        title: `${item.name} is installed${where ? ` at ${where}` : ""}, but \`${command}\` isn't on PATH, so terminals can't find it`,
        fix: isTheCommand
          ? `Open a new terminal first. If it's still missing, add ${parse(where).dir} to PATH. ${pathHelp}`
          : where?.endsWith(".app")
            ? `The app works; only its terminal command is missing. In VS Code-style editors: Command Palette → "Shell Command: Install '${command}' command in PATH".`
            : `Open a new terminal first. If it's still missing, reinstall it: dkit install ${item.id}`,
      });
    }
  }

  // 3. npm's global folder: without it on PATH, `npm install -g` tools (pnpm, prettier...) aren't found.
  const npm = runner.which("npm");
  if (npm && !(platform.wsl && isWindowsSidePath(npm))) {
    const prefix = runner.run("npm", ["prefix", "-g"]).stdout.trim();
    const bin = prefix && (os === "windows" ? prefix : path.posix.join(prefix, "bin"));
    if (bin && !onPath(bin)) {
      findings.push({
        level: "problem",
        title: "npm's global folder isn't on PATH: tools installed with `npm install -g` won't be found",
        lines: [bin],
        fix: os === "windows" ? `Add ${bin} to your user Path. ${pathHelp}` : `echo 'export PATH="${bin}:$PATH"' >> ${os === "macos" ? "~/.zshrc" : "~/.bashrc"}  then open a new terminal.`,
      });
    }
  }

  // 4. Updates.
  let updates: UpdateInfo[] = [];
  let updateErrors: string[] = [];
  if (opts.updates !== false) ({ updates, errors: updateErrors } = checkUpdates(deps));
  return { findings, updates, updateErrors, checkedUpdates: opts.updates !== false };
}
