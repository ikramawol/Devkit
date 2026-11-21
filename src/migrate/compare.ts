import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { PlatformInfo } from "../core/platform.js";
import { editorUserDir } from "../core/platform.js";
import { getItem } from "../core/catalog.js";
import { shareableGit } from "../manifest/discover.js";
import type { Manifest } from "../manifest/manifest.js";
import { c, type Logger } from "../utils/logger.js";
import { type Backup, type BundledFile, sha256, unbundle } from "./bundle.js";
import { EDITORS } from "./editors.js";
import type { BackupFileInfo } from "./archive.js";

/** A settings file in the backup and where restore would put it on this machine. */
export interface FileTarget {
  section: "editors" | "git" | "claude" | "ssh" | "shell";
  /** "VS Code", "Claude Code", ... */
  owner: string;
  file: BundledFile;
  target: string;
}

/** Where each settings file in the backup goes on this machine (the same places `migrate restore` writes). */
export function fileTargets(b: Backup, platform: PlatformInfo): FileTarget[] {
  const out: FileTarget[] = [];
  const join = (base: string, rel: string) => path.join(base, ...rel.split("/"));
  for (const eb of b.editors) {
    const def = EDITORS.find((e) => e.id === eb.id);
    if (!def) continue;
    for (const f of eb.files) out.push({ section: "editors", owner: eb.name, file: f, target: join(editorUserDir(platform, def.dirName), f.path) });
  }
  if (b.git.excludesFile) out.push({ section: "git", owner: "Git", file: b.git.excludesFile, target: path.join(platform.home, ".gitignore_global") });
  for (const f of b.claude.files) out.push({ section: "claude", owner: "Claude Code", file: f, target: join(path.join(platform.home, ".claude"), f.path) });
  if (b.ssh.config) out.push({ section: "ssh", owner: "SSH", file: b.ssh.config, target: path.join(platform.home, ".ssh", "config") });
  for (const s of b.shell) {
    const fits = platform.os === "windows" ? s.kind === "powershell" : s.kind !== "powershell";
    if (fits) out.push({ section: "shell", owner: `${s.kind} profile`, file: s.file, target: join(platform.home, s.file.path) });
  }
  return out;
}

export type FileState = "same" | "different" | "missing";

export interface FileDiff extends FileTarget {
  state: FileState;
}

/** Compare each settings file in the backup with the one on this machine. Read-only. */
export function compareFiles(b: Backup, platform: PlatformInfo): FileDiff[] {
  return fileTargets(b, platform).map((t) => {
    if (!existsSync(t.target)) return { ...t, state: "missing" };
    return { ...t, state: sha256(readFileSync(t.target)) === t.file.sha256 ? "same" : "different" };
  });
}

/** MCP servers in the backup vs this machine's ~/.claude.json. */
export function compareMcp(b: Backup, platform: PlatformInfo): { name: string; here: boolean }[] {
  let have: Record<string, unknown> = {};
  try {
    have = JSON.parse(readFileSync(path.join(platform.home, ".claude.json"), "utf8")).mcpServers ?? {};
  } catch { /* no Claude Code config here */ }
  return Object.keys(b.claude.mcpServers).map((name) => ({ name, here: name in have }));
}

/** Backups from dkit 0.2 have no manifest: build one from what they do have (no versions). */
export function manifestOf(b: Backup): Manifest {
  if (b.manifest) return b.manifest;
  return {
    format: "dkit-manifest", version: 1, createdAt: b.createdAt, source: { os: b.source.os, arch: "unknown" },
    tools: b.tools.map((id) => ({ id })),
    editors: b.editors.map((e) => ({ id: e.id, extensions: e.extensions })),
    npmGlobals: b.npmGlobals,
    git: shareableGit(b.git.config),
    shells: [...new Set(b.shell.map((s) => s.kind))],
    secrets: [],
  };
}

/** Every bundled file whose checksum doesn't match. Empty = the backup is intact. */
export function damagedFiles(b: Backup): string[] {
  const all: BundledFile[] = [
    ...b.editors.flatMap((e) => e.files), ...b.claude.files, ...b.shell.map((s) => s.file),
    ...(b.git.excludesFile ? [b.git.excludesFile] : []), ...(b.ssh.config ? [b.ssh.config] : []),
  ];
  return all.filter((f) => { try { unbundle(f); return false; } catch { return true; } }).map((f) => f.path);
}

const kb = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const short = (xs: string[], n = 8) => xs.slice(0, n).join(", ") + (xs.length > n ? c.dim(` +${xs.length - n} more`) : "");

/** `dkit migrate inspect`: what's in a backup, without changing anything. */
export function printInspect(file: string, info: BackupFileInfo, b: Backup, log: Logger) {
  log.info(c.bold(`Backup ${path.basename(file)}`) + c.dim(`  ${info.kind === "json" ? "plain JSON (old format)" : info.encrypted ? "encrypted" : "not encrypted"}, ${kb(info.size)}`));
  log.info(`Made on ${b.source.hostname} (${b.source.os}), ${b.createdAt.slice(0, 16).replace("T", " ")}`);
  const damaged = damagedFiles(b);
  log.info(damaged.length ? c.red(`✗ ${damaged.length} damaged file(s): ${short(damaged)}`) : c.green("✓ Every file is intact (checksums match)"));

  const versions = new Map((b.manifest?.tools ?? []).map((t) => [t.id, t.version]));
  log.info(c.bold(`\nTools (${b.tools.length})`));
  log.info(`  ${short(b.tools.map((id) => `${getItem(id)?.name ?? id}${versions.get(id) ? ` ${versions.get(id)}` : ""}`), 30)}`);
  if (b.extraApps.ids.length) log.info(`${c.bold(`Other apps (${b.extraApps.ids.length})`)}: ${short(b.extraApps.ids)}`);
  for (const e of b.editors)
    log.info(`${c.bold(e.name)}: ${e.extensions.length} extensions, ${e.files.length} settings files ${c.dim(`(${short(e.files.map((f) => f.path), 5)})`)}`);
  if (b.git.config.length || b.git.excludesFile) log.info(`${c.bold("Git")}: ${b.git.config.length} settings${b.git.excludesFile ? ", global gitignore" : ""}`);
  const mcp = Object.keys(b.claude.mcpServers);
  if (b.claude.files.length || mcp.length)
    log.info(`${c.bold("Claude Code")}: ${b.claude.files.length} files${mcp.length ? `, MCP servers: ${mcp.join(", ")}` : ""}`);
  if (b.npmGlobals.length) log.info(`${c.bold("Global npm packages")}: ${short(b.npmGlobals)}`);
  if (b.ssh.config) log.info(`${c.bold("SSH")}: config only ${c.dim("(never keys)")}`);
  for (const s of b.shell) log.info(`${c.bold("Shell")}: ${s.kind} profile ${c.dim(s.file.path)}`);
  if (b.notes.length) {
    log.info(c.bold("\nNotes from export"));
    for (const n of b.notes) log.info(`  • ${n}`);
  }
}

/** The settings-file part of `dkit migrate compare`. */
export function printFileComparison(files: FileDiff[], mcp: { name: string; here: boolean }[], log: Logger) {
  if (!files.length && !mcp.length) return;
  log.info(c.bold("\nSettings files") + c.dim("  (what restore would do)"));
  const owners = [...new Set(files.map((f) => f.owner))];
  for (const owner of owners) {
    const mine = files.filter((f) => f.owner === owner);
    const by = (s: FileState) => mine.filter((f) => f.state === s).map((f) => f.file.path);
    const [same, diff, missing] = [by("same"), by("different"), by("missing")];
    const mark = diff.length || missing.length ? c.yellow("≠") : c.green("✓");
    const parts = [
      same.length ? `${same.length} same` : "",
      diff.length ? `${diff.length} different: ${short(diff, 4)} ${c.dim("(would be replaced, old copy kept)")}` : "",
      missing.length ? `${missing.length} not here: ${short(missing, 4)} ${c.dim("(would be created)")}` : "",
    ].filter(Boolean);
    log.info(`  ${mark} ${owner.padEnd(20)} ${parts.join("; ")}`);
  }
  if (mcp.length) {
    const absent = mcp.filter((m) => !m.here).map((m) => m.name);
    log.info(`  ${absent.length ? c.yellow("≠") : c.green("✓")} ${"MCP servers".padEnd(20)} ${absent.length ? `not here: ${absent.join(", ")}` : `all ${mcp.length} here`}`);
  }
}
