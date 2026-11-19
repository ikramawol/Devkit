import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, copyFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { OS } from "../core/platform.js";

/** One file carried in the backup. `path` is relative and always uses forward slashes. */
export interface BundledFile {
  path: string;
  base64: string;
  sha256: string;
}

export interface EditorBackup {
  /** "vscode" | "antigravity" */
  id: string;
  name: string;
  extensions: string[];
  /** Relative to the editor's User folder: settings.json, keybindings.json, snippets/... */
  files: BundledFile[];
}

export interface Backup {
  format: "dkit-backup";
  version: 1;
  createdAt: string;
  source: { os: OS; hostname: string };
  /** Catalog ids that were installed on the old machine. */
  tools: string[];
  /** Other apps winget knows about (Windows only), restorable on Windows. */
  extraApps: { source: "winget"; ids: string[] };
  editors: EditorBackup[];
  git: { config: [string, string][]; excludesFile?: BundledFile };
  claude: { files: BundledFile[]; mcpServers: Record<string, unknown> };
  npmGlobals: string[];
  ssh: { config?: BundledFile };
  shell: { kind: "powershell" | "bash" | "zsh"; file: BundledFile }[];
  /** Things the user must do by hand (secrets removed, etc.). */
  notes: string[];
}

export const sha256 = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

export function bundleFile(relPath: string, buf: Buffer): BundledFile {
  return { path: relPath.split(path.sep).join("/"), base64: buf.toString("base64"), sha256: sha256(buf) };
}

export function unbundle(f: BundledFile): Buffer {
  const buf = Buffer.from(f.base64, "base64");
  if (sha256(buf) !== f.sha256) throw new Error(`Checksum mismatch for ${f.path}: the backup is damaged`);
  return buf;
}

/** A copy that `writeWithBackup` left next to a file it replaced. */
const DKIT_BACKUP_COPY = /\.dkit-backup-[\dT-]+$/;

/**
 * Recursively collect files under `dir`, skipping anything over `maxBytes`.
 * Always skipped: hidden folders (.git, .trash, ...), node_modules, and dkit's own backup copies.
 * `skip` lists further folders to leave out, as paths relative to `dir` with forward slashes.
 */
export function collectDir(dir: string, prefix = "", maxBytes = 2 * 1024 * 1024, skip: string[] = [], _rel = ""): BundledFile[] {
  if (!existsSync(dir)) return [];
  const out: BundledFile[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.join(prefix, entry.name);
    const relInDir = _rel ? `${_rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".") || skip.includes(relInDir)) continue;
      out.push(...collectDir(full, rel, maxBytes, skip, relInDir));
    } else if (DKIT_BACKUP_COPY.test(entry.name)) {
      continue;
    } else if (entry.isFile() && statSync(full).size <= maxBytes) {
      out.push(bundleFile(rel, readFileSync(full)));
    }
  }
  return out;
}

// ── Secret redaction ──────────────────────────────────────────

const SECRET_KEY = /(token|secret|passw(or)?d|passwd|api[-_]?key|apikey|auth(orization)?|credential|bearer|private[-_]?key)/i;
export const REDACTED = "<REDACTED>";

/** Replace string values whose key looks secret. Returns the dotted paths that were redacted. */
export function redactJson(value: unknown, trail = ""): { value: unknown; redacted: string[] } {
  const redacted: string[] = [];
  const walk = (v: unknown, t: string): unknown => {
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${t}[${i}]`));
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v)) {
        const p = t ? `${t}.${k}` : k;
        if (typeof x === "string" && SECRET_KEY.test(k) && x !== REDACTED) {
          out[k] = REDACTED;
          redacted.push(p);
        } else out[k] = walk(x, p);
      }
      return out;
    }
    return v;
  };
  return { value: walk(value, trail), redacted };
}

/** VS Code settings are JSONC (comments, trailing commas), so redact by pattern instead of parsing. */
export function redactJsonc(text: string): { text: string; redacted: string[] } {
  const redacted: string[] = [];
  const out = text.replace(/"([^"]+)"(\s*:\s*)"([^"]{6,})"/g, (m, key: string, sep: string) => {
    if (!SECRET_KEY.test(key)) return m;
    redacted.push(key);
    return `"${key}"${sep}"${REDACTED}"`;
  });
  return { text: out, redacted };
}

/** Well-known token formats, caught wherever they appear (OpenAI/Anthropic, GitHub, AWS, Slack, Google). */
const TOKEN_VALUE = /\b(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[abpr]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,})/g;

/** A literal value, not a reference to something else ($other, $(command), `command`). */
const isLiteral = (v: string) => v.length > 0 && v !== REDACTED && !/^[$(`]/.test(v);

/**
 * Shell profiles (PowerShell, bash, zsh) often set API keys directly:
 *   $env:OPENAI_API_KEY = "sk-..."      export GITHUB_TOKEN=ghp_...
 *   [Environment]::SetEnvironmentVariable("API_KEY", "...", "User")
 * Replace those values (keeping the line, so it's easy to fill back in) and any well-known token format.
 */
export function redactShell(text: string): { text: string; redacted: string[] } {
  const redacted: string[] = [];
  const mask = (name: string, value: string, quote: string) => {
    if (!SECRET_KEY.test(name) || !isLiteral(value)) return null;
    redacted.push(name);
    return `${quote}${REDACTED}${quote}`;
  };

  // NAME = "value" | 'value' | value   after $env:, $, export, or at the start of a line.
  let out = text.replace(
    /(\$env:|\$|\bexport\s+|^[ \t]*)([A-Za-z_]\w*)([ \t]*=(?!=)[ \t]*)(?:"([^"\n]*)"|'([^'\n]*)'|([^\s;#"']+))/gm,
    (m, pre: string, name: string, eq: string, dq?: string, sq?: string, bare?: string) => {
      // In PowerShell an unquoted value is a command (`$token = Get-Secret`), not a literal.
      if (bare !== undefined && pre.startsWith("$")) return m;
      const value = dq ?? sq ?? bare ?? "";
      const quote = dq !== undefined ? '"' : sq !== undefined ? "'" : "";
      const masked = mask(name, value, quote);
      return masked ? `${pre}${name}${eq}${masked}` : m;
    },
  );
  // [Environment]::SetEnvironmentVariable("NAME", "value", ...)
  out = out.replace(
    /(SetEnvironmentVariable\(\s*)(["'])(\w+)\2(\s*,\s*)(["'])([^"'\n]*)\5/g,
    (m, pre: string, q1: string, name: string, sep: string, q2: string, value: string) => {
      const masked = mask(name, value, q2);
      return masked ? `${pre}${q1}${name}${q1}${sep}${masked}` : m;
    },
  );
  // Anything that still looks like a real token (e.g. inside a curl header or an alias).
  out = out.replace(TOKEN_VALUE, () => {
    redacted.push("token");
    return REDACTED;
  });
  return { text: out, redacted: [...new Set(redacted)] };
}

// ── Safe writes ───────────────────────────────────────────────

export type WriteOutcome = "created" | "replaced" | "unchanged";

/** Write a file, keeping a timestamped copy of anything it overwrites. */
export function writeWithBackup(target: string, buf: Buffer, stamp: string, dryRun: boolean): WriteOutcome {
  if (existsSync(target)) {
    if (sha256(readFileSync(target)) === sha256(buf)) return "unchanged";
    if (!dryRun) {
      copyFileSync(target, `${target}.dkit-backup-${stamp}`);
      writeFileSync(target, buf);
    }
    return "replaced";
  }
  if (!dryRun) {
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, buf);
  }
  return "created";
}

/** Find paths in text that only make sense on another OS. */
export function foreignPaths(text: string, target: OS): string[] {
  const re = target === "windows" ? /(\/Users\/|\/home\/)[^\s"']+/g : /[A-Za-z]:\\\\?[^\s"']+/g;
  return [...new Set(text.match(re) ?? [])].slice(0, 5);
}
