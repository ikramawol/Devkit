import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { PlatformInfo } from "../core/platform.js";
import { parseJson } from "../utils/json.js";

/**
 * Folders that a cloud app (OneDrive, Dropbox, Google Drive, iCloud Drive) keeps in sync.
 * dkit only writes files there; the app does the uploading. dkit never signs in to anything,
 * and everything it writes is encrypted on this PC first.
 */

export interface CloudFolder {
  provider: "OneDrive" | "Dropbox" | "Google Drive" | "iCloud Drive" | "Box";
  path: string;
}

export interface CloudDeps {
  env?: Record<string, string | undefined>;
  exists?: (p: string) => boolean;
  readFile?: (p: string) => string;
  listDir?: (p: string) => string[];
}

/** Dropbox writes where its folder is to info.json: {"personal": {"path": "..."}, "business": {...}}. */
function dropboxFromInfo(file: string, read: (p: string) => string): string[] {
  try {
    const info = parseJson(read(file)) as Record<string, { path?: unknown }>;
    return Object.values(info).map((a) => a?.path).filter((p): p is string => typeof p === "string" && !!p);
  } catch {
    return [];
  }
}

export function findCloudFolders(platform: PlatformInfo, deps: CloudDeps = {}): CloudFolder[] {
  const env = deps.env ?? process.env;
  const exists = deps.exists ?? existsSync;
  const read = deps.readFile ?? ((p: string) => readFileSync(p, "utf8"));
  const list = deps.listDir ?? ((p: string) => { try { return readdirSync(p); } catch { return []; } });
  const found: CloudFolder[] = [];
  const add = (provider: CloudFolder["provider"], p: string | undefined) => {
    if (!p || !exists(p)) return;
    const key = platform.os === "windows" ? p.toLowerCase() : p;
    if (!found.some((f) => (platform.os === "windows" ? f.path.toLowerCase() : f.path) === key)) found.push({ provider, path: p });
  };
  const home = platform.home;
  const join = platform.os === "windows" ? path.win32.join : path.posix.join;

  if (platform.os === "windows") {
    // OneDrive sets these for personal and work/school accounts.
    add("OneDrive", env.OneDrive);
    add("OneDrive", env.OneDriveConsumer);
    add("OneDrive", env.OneDriveCommercial);
    for (const base of [env.APPDATA, env.LOCALAPPDATA].filter(Boolean) as string[])
      for (const p of dropboxFromInfo(join(base, "Dropbox", "info.json"), read)) add("Dropbox", p);
    add("Dropbox", join(home, "Dropbox"));
    // Google Drive for desktop shows up as its own drive letter (G: unless that's taken).
    for (const letter of "GHIJKLMNOPQRSTUVWXYZDEF") add("Google Drive", `${letter}:\\My Drive`);
    add("iCloud Drive", join(home, "iCloudDrive"));
    return found;
  }

  if (platform.os === "macos") {
    // Current OneDrive, Dropbox, Google Drive and Box apps all live under ~/Library/CloudStorage.
    const storage = join(home, "Library", "CloudStorage");
    for (const name of list(storage).sort()) {
      if (name.startsWith("OneDrive")) add("OneDrive", join(storage, name));
      else if (name.startsWith("Dropbox")) add("Dropbox", join(storage, name));
      else if (name.startsWith("GoogleDrive")) add("Google Drive", join(storage, name, "My Drive"));
      else if (name.startsWith("Box")) add("Box", join(storage, name));
    }
    add("iCloud Drive", join(home, "Library", "Mobile Documents", "com~apple~CloudDocs"));
  }

  // macOS (older Dropbox) and Linux.
  for (const p of dropboxFromInfo(join(home, ".dropbox", "info.json"), read)) add("Dropbox", p);
  add("Dropbox", join(home, "Dropbox"));
  return found;
}
