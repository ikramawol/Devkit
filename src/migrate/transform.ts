import type { OS } from "../core/platform.js";
import type { ShellKind } from "../manifest/discover.js";

/**
 * Settings that mean something different on another OS, translated during a cross-OS restore.
 * Anything dkit can't translate safely is left out and reported, never guessed.
 */

export interface GitTransform {
  /** null = don't set it on this OS. */
  values: string[] | null;
  note?: string;
}

/** Translate one Git setting from the old OS to the new one. */
export function transformGit(key: string, values: string[], from: OS, to: OS): GitTransform {
  if (from === to) return { values };
  const k = key.toLowerCase();
  const v = values[0]?.toLowerCase();
  if (k === "core.autocrlf") {
    // Windows wants CRLF in the working folder; macOS/Linux want LF. "input" and "true" are each OS's usual choice.
    if (from === "windows" && v === "true" && to !== "windows")
      return { values: ["input"], note: `Git core.autocrlf was "true" on Windows; set to "input" (the usual choice on ${to}) so files keep LF line endings.` };
    if (from !== "windows" && to === "windows" && (v === "input" || v === "false"))
      return { values: ["true"], note: `Git core.autocrlf was "${values[0]}" on ${from}; set to "true" (the usual choice on Windows).` };
  }
  // Windows-only editors and tools named without a path.
  if ((k === "core.editor" || k === "diff.tool" || k === "merge.tool" || k === "core.pager") && to !== "windows" && /\b(notepad(\+\+)?|winmerge|tortoise\w*)(\.exe)?\b/i.test(values[0] ?? ""))
    return { values: null, note: `Git ${key} = ${values[0]} is a Windows program; set it again for ${to}.` };
  return { values };
}

// ── Shell profiles ───────────────────────────────────────────

export interface ConvertedProfile {
  text: string;
  /** Lines turned into the other shell's form. */
  converted: number;
  /** Lines with code that was left out (comments and blank lines not counted). */
  skipped: number;
}

/** Backslashes, %VARS% and Windows-only folders ($env:USERPROFILE\go) don't mean anything on macOS/Linux. */
const WINDOWS_PATH = /\\|%\w+%|\$env:(USERPROFILE|APPDATA|LOCALAPPDATA|ProgramFiles|ProgramData|SystemRoot|windir|TEMP|TMP)\b/i;
const UNIX_PATH = /(^|[\s="':])\/(usr|opt|home|Users|bin|etc|var)\//;
/** A plain command line: no pipes, redirects, subshells or chaining. */
const SIMPLE_CMD = /^[\w.\-/ :=@"]+$/;

/** PowerShell → bash/zsh. Converts `$env:NAME = "value"`, `Set-Alias`, and one-line functions that just run a command. */
function fromPowerShell(lines: string[]): { out: string[]; converted: number; skipped: number } {
  const out: string[] = [];
  let converted = 0;
  let skipped = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^\$env:([A-Za-z_]\w*)\s*=\s*(?:"([^"`]*)"|'((?:[^']|'')*)')\s*;?$/))) {
      const [, name, dq, sqRaw] = m;
      const sq = sqRaw?.replace(/''/g, "'"); // PowerShell writes ' inside '...' as ''
      const value = dq ?? sq ?? "";
      if (name.toUpperCase() === "PATH" || WINDOWS_PATH.test(value) || /\$\(/.test(value)) { skipped++; continue; }
      // $env:OTHER inside a double-quoted value becomes ${OTHER}.
      const v = dq !== undefined ? value.replace(/\$env:(\w+)/g, (_, n: string) => `\${${n}}`) : value.replace(/'/g, "'\\''");
      out.push(dq !== undefined ? `export ${name}="${v}"` : `export ${name}='${v}'`);
      converted++;
    } else if ((m = line.match(/^Set-Alias\s+(?:-Name\s+)?([\w.-]+)\s+(?:-Value\s+)?([\w.-]+)\s*$/i))) {
      out.push(`alias ${m[1]}='${m[2]}'`);
      converted++;
    } else if ((m = line.match(/^function\s+([\w-]+)\s*\{\s*(.+?)\s*\}$/i)) && SIMPLE_CMD.test(m[2]) && !WINDOWS_PATH.test(m[2])) {
      out.push(`${m[1]}() { ${m[2].replace(/@args/g, '"$@"')}; }`);
      converted++;
    } else skipped++;
  }
  return { out, converted, skipped };
}

/** bash/zsh → PowerShell. Converts `export NAME=value` and `alias name='command ...'`. */
function toPowerShell(lines: string[]): { out: string[]; converted: number; skipped: number } {
  const out: string[] = [];
  let converted = 0;
  let skipped = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^export\s+([A-Za-z_]\w*)=(?:"([^"`]*)"|'([^']*)'|([^\s"'`;]*))\s*;?$/))) {
      const [, name, dq, sq, bare] = m;
      const value = dq ?? sq ?? bare ?? "";
      if (name === "PATH" || UNIX_PATH.test(value) || /\$\(|~\//.test(value)) { skipped++; continue; }
      // $NAME / ${NAME} → $env:NAME ($HOME exists in PowerShell as-is).
      const v = sq !== undefined ? value.replace(/'/g, "''") : value.replace(/\$\{?(\w+)\}?/g, (_, n: string) => (n === "HOME" ? "$HOME" : `$env:${n}`));
      out.push(sq !== undefined ? `$env:${name} = '${v}'` : `$env:${name} = "${v}"`);
      converted++;
    } else if ((m = line.match(/^alias\s+([\w.-]+)=(?:'([^']*)'|"([^"]*)"|(\S+))\s*$/))) {
      const name = m[1];
      const body = (m[2] ?? m[3] ?? m[4] ?? "").trim();
      if (!SIMPLE_CMD.test(body) || UNIX_PATH.test(body)) { skipped++; continue; }
      // PowerShell has built-in aliases (gc, gp, gl, ...) that would win over a function with the same name.
      out.push(`Remove-Item Alias:${name} -Force -ErrorAction SilentlyContinue`);
      out.push(/\s/.test(body) ? `function ${name} { ${body} @args }` : `Set-Alias ${name} ${body}`);
      converted++;
    } else skipped++;
  }
  return { out, converted, skipped };
}

export const isPowerShell = (k: ShellKind) => k === "powershell";

/** Convert a profile to the shell used on `toOs` (PowerShell on Windows, bash/zsh elsewhere). */
export function convertProfile(text: string, from: ShellKind, sourceLabel: string): ConvertedProfile {
  const lines = text.split(/\r?\n/);
  const { out, converted, skipped } = isPowerShell(from) ? fromPowerShell(lines) : toPowerShell(lines);
  const header = [
    `# From your ${from} profile (${sourceLabel}), converted by dkit.`,
    `# Only environment variables and simple aliases are converted; ${skipped} other line(s) were left out (the original is in your backup).`,
  ];
  if (text.includes("<REDACTED>")) header.push("# Values shown as <REDACTED> were secrets: fill them in.");
  return { text: [...header, ...out, ""].join("\n"), converted, skipped };
}

/** Where a converted profile goes, and how to load it from the shell you use on this OS. */
export function convertedProfileTarget(home: string, os: OS, join: (...p: string[]) => string): { file: string; howToLoad: string } {
  if (os === "windows") {
    const file = join(home, ".dkit", "converted", "profile.ps1");
    return { file, howToLoad: `add this line to your PowerShell profile (notepad $PROFILE): . "${file}"` };
  }
  const file = join(home, ".dkit", "converted", "profile.sh");
  const rc = os === "macos" ? "~/.zshrc" : "~/.bashrc";
  return { file, howToLoad: `add this line to ${rc}: source ~/.dkit/converted/profile.sh` };
}
