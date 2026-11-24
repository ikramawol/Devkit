import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PlatformInfo } from "../core/platform.js";
import { createBackup, type ExportDeps } from "../migrate/export.js";
import { BACKUP_EXT, writeBackupFile } from "../migrate/archive.js";
import type { StoreKind } from "../utils/secret-store.js";
import type { When } from "./schedule.js";
import { parseJson } from "../utils/json.js";

/**
 * Snapshots are ordinary encrypted .dkit backups (same as `dkit migrate export`), made on a schedule
 * and kept in one folder. Only the newest `keep` are kept. Restore one with `dkit migrate restore`.
 */

export interface SnapshotConfig {
  folder: string;
  keep: number;
  when?: When;
  /** Where the password is stored (set by `dkit snapshot schedule`). */
  store?: StoreKind;
  lastRun?: { at: string; ok: boolean; file?: string; error?: string };
}

export const DEFAULT_KEEP = 7;
export const configFile = (p: PlatformInfo) => path.join(p.home, ".dkit", "snapshots.json");
export const logFile = (p: PlatformInfo) => path.join(p.home, ".dkit", "snapshots.log");
export const defaultFolder = (p: PlatformInfo) => path.join(p.home, ".dkit", "snapshots");

export function loadConfig(platform: PlatformInfo): SnapshotConfig {
  const fallback: SnapshotConfig = { folder: defaultFolder(platform), keep: DEFAULT_KEEP };
  try {
    const c = parseJson(readFileSync(configFile(platform), "utf8")) as Partial<SnapshotConfig>;
    return {
      ...fallback,
      ...c,
      folder: typeof c.folder === "string" && c.folder ? c.folder : fallback.folder,
      keep: Number.isInteger(c.keep) && c.keep! > 0 ? c.keep! : fallback.keep,
    };
  } catch {
    return fallback;
  }
}

export function saveConfig(platform: PlatformInfo, cfg: SnapshotConfig) {
  mkdirSync(path.dirname(configFile(platform)), { recursive: true });
  writeFileSync(configFile(platform), JSON.stringify(cfg, null, 2) + "\n");
}

/** snapshot-<host>-YYYYMMDD-HHMMSS.dkit: sorts by time, and only files named like this are ever deleted. */
const SNAPSHOT_FILE = /^snapshot-[a-z0-9-]+-(\d{8})-(\d{6})\.dkit$/;

export function snapshotName(hostname: string, now: Date): string {
  const host = hostname.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "pc";
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const t = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `snapshot-${host}-${d}-${t}${BACKUP_EXT}`;
}

export interface SnapshotFile { file: string; name: string; size: number; taken: Date }

/** Snapshots in the folder, newest first. */
export function listSnapshots(folder: string): SnapshotFile[] {
  if (!existsSync(folder)) return [];
  const out: SnapshotFile[] = [];
  for (const name of readdirSync(folder)) {
    const m = name.match(SNAPSHOT_FILE);
    if (!m) continue;
    const [, d, t] = m;
    const taken = new Date(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +t.slice(0, 2), +t.slice(2, 4), +t.slice(4, 6));
    const file = path.join(folder, name);
    out.push({ file, name, size: statSync(file).size, taken });
  }
  return out.sort((a, b) => b.taken.getTime() - a.taken.getTime() || b.name.localeCompare(a.name));
}

export interface SnapshotResult { file: string; removed: string[]; notes: string[] }

/** Take a snapshot now and delete the oldest beyond `keep`. */
export function takeSnapshot(deps: ExportDeps, cfg: SnapshotConfig, password: string, now = new Date()): SnapshotResult {
  mkdirSync(cfg.folder, { recursive: true });
  const file = path.join(cfg.folder, snapshotName(deps.platform.hostname, now));
  const backup = createBackup(deps);
  writeBackupFile(file, backup, password);
  const removed = listSnapshots(cfg.folder).slice(cfg.keep).map((s) => s.file);
  for (const f of removed) rmSync(f, { force: true });
  return { file, removed, notes: backup.notes };
}

/** One line per scheduled run, so you can see what happened while you weren't looking. */
export function logRun(platform: PlatformInfo, line: string) {
  try {
    mkdirSync(path.dirname(logFile(platform)), { recursive: true });
    appendFileSync(logFile(platform), `${new Date().toISOString()}  ${line}\n`);
  } catch { /* logging must never break the snapshot */ }
}
