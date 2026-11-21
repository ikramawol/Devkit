import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Runner } from "../utils/run.js";
import { isWindowsSidePath, type PlatformInfo } from "./platform.js";
import type { CatalogItem } from "./catalog.js";

export interface ToolStatus {
  id: string;
  name: string;
  installed: boolean;
  version?: string;
  where?: string;
}

export interface DetectDeps {
  runner: Runner;
  platform: PlatformInfo;
  exists?: (p: string) => boolean;
}

const firstVersion = (s: string) => s.match(/\d+\.\d+(\.\d+)?/)?.[0];

/** Expand %VAR% and a leading ~ in a configured path. */
export function expandPath(p: string, platform: PlatformInfo): string {
  let out = p.replace(/%([^%]+)%/g, (_, v: string) => {
    if (v.toUpperCase() === "USERPROFILE") return platform.home;
    return process.env[v] ?? process.env[v.toUpperCase()] ?? `%${v}%`;
  });
  if (out.startsWith("~")) out = path.join(platform.home, out.slice(1));
  return out;
}

export function detectItem(item: CatalogItem, deps: DetectDeps): ToolStatus {
  const { runner, platform } = deps;
  const exists = deps.exists ?? existsSync;
  const base = { id: item.id, name: item.name };
  const { versionArgs, paths, commandOn, commandFor, windowsSideInWsl } = item.detect;
  const command = commandFor?.[platform.os] ?? item.detect.command;

  // 1. A working command on PATH.
  if (command && (!commandOn || commandOn.includes(platform.os))) {
    let resolved = runner.which(command);
    // In WSL, /mnt/c/... is the Windows copy (e.g. Windows npm), which can't run as a Linux tool.
    if (resolved && platform.wsl && isWindowsSidePath(resolved) && !windowsSideInWsl) resolved = null;
    if (resolved) {
      const r = runner.run(resolved, versionArgs ?? ["--version"]);
      // Some tools (ssh -V) print their version to stderr.
      const out = `${r.stdout}\n${r.stderr}`;
      if (r.ok) return { ...base, installed: true, version: firstVersion(out), where: resolved };
    }
  }

  // 2. A GUI app (or a fresh install not yet on PATH) at a known location.
  for (const p of paths?.[platform.os] ?? []) {
    const full = expandPath(p, platform);
    if (exists(full)) return { ...base, installed: true, where: full };
  }

  // 3. Windows: ask winget, which knows about apps installed any way.
  const method = item.install[platform.os];
  if (platform.os === "windows" && method?.type === "winget" && runner.which("winget")) {
    const all = wingetInstalled(runner);
    if (all) {
      if (all.has(method.id.toLowerCase())) return { ...base, installed: true, where: "winget" };
    } else {
      // The one-shot export failed: fall back to asking about this package alone (slower).
      const r = runner.run("winget", ["list", "--id", method.id, "--exact", "--accept-source-agreements", "--disable-interactivity"]);
      if (r.ok && r.stdout.includes(method.id)) return { ...base, installed: true, where: "winget" };
    }
  }

  return { ...base, installed: false };
}

// One `winget export` lists every installed package in a few seconds; one `winget list` per
// tool takes ~20s each. Cached per runner, so a single command run asks winget only once.
const wingetCache = new WeakMap<Runner, Set<string> | null>();

/** Lower-cased ids of every package winget sees as installed, or null if winget couldn't tell us. */
export function wingetInstalled(runner: Runner): Set<string> | null {
  if (wingetCache.has(runner)) return wingetCache.get(runner)!;
  let ids: Set<string> | null = null;
  const dir = mkdtempSync(path.join(os.tmpdir(), "dkit-winget-"));
  try {
    const file = path.join(dir, "installed.json");
    runner.run("winget", ["export", "-o", file, "--accept-source-agreements", "--disable-interactivity"]);
    // winget exits non-zero when some apps aren't in any source, but still writes the file.
    if (existsSync(file)) {
      const data = JSON.parse(readFileSync(file, "utf8")) as { Sources?: { Packages?: { PackageIdentifier?: string }[] }[] };
      ids = new Set();
      for (const src of data.Sources ?? [])
        for (const p of src.Packages ?? []) if (p.PackageIdentifier) ids.add(p.PackageIdentifier.toLowerCase());
    }
  } catch {
    ids = null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  wingetCache.set(runner, ids);
  return ids;
}

/** Forget what winget reported, after installing something. */
export function clearWingetCache(runner: Runner) {
  wingetCache.delete(runner);
}
