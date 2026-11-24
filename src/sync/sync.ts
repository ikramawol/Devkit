import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PlatformInfo } from "../core/platform.js";
import { BACKUP_EXT, WrongPasswordError, packBackup, unpackBackup } from "../migrate/archive.js";
import type { Backup } from "../migrate/bundle.js";
import { createBackup, type ExportDeps } from "../migrate/export.js";
import { parseJson } from "../utils/json.js";
import type { StoreKind } from "../utils/secret-store.js";

/**
 * Keeping several PCs' setups in step through a folder that a cloud app syncs:
 *
 *   <OneDrive>/dkit-sync/
 *     dkit-sync.json          marks the folder (no personal data)
 *     machines/laptop.dkit    each PC's latest setup: an encrypted backup, like `dkit migrate export`
 *     machines/desktop.dkit
 *
 * `push` saves this PC's file; `pull` compares another PC's file with this one and restores what you pick,
 * using the same plan → confirm → act steps as `dkit migrate restore` (tools are only ever added).
 * Every PC uses the same password, so any PC can read the others' files. The cloud only sees encrypted data.
 */

export const SYNC_DIR = "dkit-sync";
export const MARKER = "dkit-sync.json";
export const MACHINES = "machines";

const MACHINE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export interface SyncConfig {
  /** The dkit-sync folder itself. */
  folder: string;
  /** This PC's name in the folder (its file is machines/<machine>.dkit). */
  machine: string;
  store?: StoreKind;
  lastPush?: string;
  lastPull?: { at: string; from: string };
}

export const syncConfigFile = (p: PlatformInfo) => path.join(p.home, ".dkit", "sync.json");

export function loadSyncConfig(platform: PlatformInfo): SyncConfig | null {
  try {
    const c = parseJson(readFileSync(syncConfigFile(platform), "utf8")) as Partial<SyncConfig>;
    if (typeof c.folder !== "string" || typeof c.machine !== "string" || !MACHINE.test(c.machine)) return null;
    return c as SyncConfig;
  } catch {
    return null;
  }
}

export function saveSyncConfig(platform: PlatformInfo, cfg: SyncConfig) {
  mkdirSync(path.dirname(syncConfigFile(platform)), { recursive: true });
  writeFileSync(syncConfigFile(platform), JSON.stringify(cfg, null, 2) + "\n");
}

export function removeSyncConfig(platform: PlatformInfo) {
  rmSync(syncConfigFile(platform), { force: true });
}

/** "Ikram's Laptop" → "ikram-s-laptop": a safe file name. */
export function machineName(hostname: string): string {
  return hostname.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 63) || "pc";
}

export const validMachineName = (name: string) => MACHINE.test(name);

export const isSyncFolder = (dir: string) => existsSync(path.join(dir, MARKER));

/** The dkit-sync folder to use for what the user pointed at: the folder itself, or dkit-sync inside it. */
export function syncFolderFor(dir: string): string {
  return path.basename(dir).toLowerCase() === SYNC_DIR || isSyncFolder(dir) ? dir : path.join(dir, SYNC_DIR);
}

export function createSyncFolder(dir: string) {
  mkdirSync(path.join(dir, MACHINES), { recursive: true });
  if (!isSyncFolder(dir)) writeFileSync(path.join(dir, MARKER), JSON.stringify({ format: "dkit-sync", version: 1, createdAt: new Date().toISOString() }, null, 2) + "\n");
}

/** Refuse a folder whose marker isn't ours, or is from a newer dkit. */
export function checkSyncFolder(dir: string) {
  let m: { format?: unknown; version?: unknown };
  try { m = parseJson(readFileSync(path.join(dir, MARKER), "utf8")) as typeof m; } catch { throw new Error(`${dir} isn't a dkit sync folder (its ${MARKER} is missing or damaged).`); }
  if (m.format !== "dkit-sync") throw new Error(`${dir}: ${MARKER} isn't a dkit sync file.`);
  if (m.version !== 1) throw new Error(`${dir} was made by a newer dkit (sync version ${String(m.version)}). Update dkit.`);
}

export interface MachineFile { name: string; file: string; modified: Date }

/**
 * The PCs in the folder. Other files (a cloud app's conflict copies like "laptop (1).dkit",
 * or half-uploaded temp files) are listed separately and never read.
 */
export function listMachines(dir: string): { machines: MachineFile[]; ignored: string[] } {
  const folder = path.join(dir, MACHINES);
  const machines: MachineFile[] = [];
  const ignored: string[] = [];
  for (const f of existsSync(folder) ? readdirSync(folder).sort() : []) {
    const name = f.endsWith(BACKUP_EXT) ? f.slice(0, -BACKUP_EXT.length) : "";
    if (MACHINE.test(name)) machines.push({ name, file: path.join(folder, f), modified: statSync(path.join(folder, f)).mtime });
    else if (!f.startsWith(".")) ignored.push(f);
  }
  return { machines, ignored };
}

export const machineFile = (cfg: Pick<SyncConfig, "folder" | "machine">) => path.join(cfg.folder, MACHINES, `${cfg.machine}${BACKUP_EXT}`);

/**
 * Save this PC's setup. Written to a hidden temp file first and then renamed, so the cloud app
 * never uploads a half-written file.
 */
export function pushMachine(deps: ExportDeps, cfg: SyncConfig, password: string): { file: string; notes: string[] } {
  if (!existsSync(cfg.folder)) throw new Error(`The sync folder ${cfg.folder} isn't there. Is your cloud app (OneDrive, Dropbox...) running and signed in?`);
  checkSyncFolder(cfg.folder);
  mkdirSync(path.join(cfg.folder, MACHINES), { recursive: true });
  const backup = createBackup(deps);
  const file = machineFile(cfg);
  const tmp = path.join(cfg.folder, MACHINES, `.${cfg.machine}.${process.pid}.tmp`);
  writeFileSync(tmp, packBackup(backup, password));
  renameSync(tmp, file);
  return { file, notes: backup.notes };
}

/** Read one PC's file with the sync password. */
export function openMachine(file: string, password: string): Promise<Backup> {
  return unpackBackup(readFileSync(file), async () => password);
}

/** true = the password opens the files here; false = it doesn't; null = no files to check it against yet. */
export async function checkSyncPassword(dir: string, password: string): Promise<boolean | null> {
  const { machines } = listMachines(dir);
  if (!machines.length) return null;
  const newest = [...machines].sort((a, b) => b.modified.getTime() - a.modified.getTime())[0];
  try {
    await openMachine(newest.file, password);
    return true;
  } catch (e) {
    if (e instanceof WrongPasswordError) return false;
    throw e;
  }
}
