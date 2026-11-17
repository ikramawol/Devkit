import { existsSync } from "node:fs";
import path from "node:path";
import type { Runner } from "../utils/run.js";
import type { PlatformInfo } from "./platform.js";
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
  const { command, versionArgs, paths } = item.detect;

  // 1. A working command on PATH.
  if (command) {
    const resolved = runner.which(command);
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
    const r = runner.run("winget", ["list", "--id", method.id, "--exact", "--accept-source-agreements", "--disable-interactivity"]);
    if (r.ok && r.stdout.includes(method.id)) return { ...base, installed: true, where: "winget" };
  }

  return { ...base, installed: false };
}
