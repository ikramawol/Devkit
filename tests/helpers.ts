import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Runner, RunResult } from "../src/utils/run.js";
import type { OS, PlatformInfo } from "../src/core/platform.js";
import type { EngineContext } from "../src/core/engine.js";
import { silentLogger } from "../src/utils/logger.js";

export const ok = (stdout = ""): RunResult => ({ ok: true, code: 0, stdout, stderr: "" });
export const fail = (stderr = "boom"): RunResult => ({ ok: false, code: 1, stdout: "", stderr });

export function tempPlatform(osName: OS): PlatformInfo {
  const home = mkdtempSync(path.join(os.tmpdir(), "dkit-test-"));
  return {
    os: osName,
    arch: "x64",
    hostname: `${osName}-box`,
    home,
    appData: path.join(home, "appdata"),
    claudeBinDir: path.join(home, ".local", "bin"),
  };
}

/**
 * A fake machine. `installed` = commands on PATH. Installing a tool through
 * winget/npm/script adds its command to `installed`, like a real install would.
 */
export function fakeRunner(opts: {
  installed: Set<string>;
  responses?: Record<string, RunResult>;
  /** PowerShell answers: first key contained in the script wins. */
  ps?: Record<string, RunResult>;
  failInstall?: Set<string>;
}) {
  const calls: string[] = [];
  const installs: Record<string, string> = {
    "Git.Git": "git", "OpenJS.NodeJS.LTS": "node", "@openai/codex": "codex",
    "Microsoft.VisualStudioCode": "code", "install.ps1": "claude", "Docker.DockerDesktop": "docker",
    "PostgreSQL.PostgreSQL.17": "psql",
  };
  const runner: Runner = {
    which: (c) => (opts.installed.has(c) ? `/fake/bin/${c}` : null),
    refreshPath: () => {},
    run: (cmd, args = []) => {
      const line = `${cmd.replace("/fake/bin/", "")} ${args.join(" ")}`.trim();
      calls.push(line);
      for (const [key, res] of Object.entries(opts.responses ?? {})) if (line.startsWith(key)) return res;
      if (args[0] === "install" || args.includes("-g")) {
        const target = Object.keys(installs).find((k) => args.includes(k));
        if (target && opts.failInstall?.has(target)) return fail();
        if (target) opts.installed.add(installs[target]);
        return ok();
      }
      if (args.some((a) => a.startsWith("--version") || a === "-V")) return ok("1.2.3");
      return ok();
    },
    powershell: (s) => {
      calls.push(`ps ${s}`);
      for (const [key, res] of Object.entries(opts.ps ?? {})) if (s.includes(key)) return res;
      if (s.includes("install.ps1")) opts.installed.add("claude");
      return ok();
    },
  };
  return { runner, calls };
}

export function engineCtx(runner: Runner, platform: PlatformInfo, extra: Partial<EngineContext> = {}): EngineContext {
  return { runner, platform, log: silentLogger, confirm: async () => true, dryRun: false, exists: () => false, ...extra };
}
