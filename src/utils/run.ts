import { spawnSync, type StdioOptions } from "node:child_process";

export interface RunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  /** Set when the program could not be started at all (e.g. not found). */
  error?: string;
}

export interface RunOptions {
  /** Show the program's output live (installers) instead of capturing it. */
  inherit?: boolean;
  /** Folder to run in (e.g. a project, for `pnpm add`). Default: the current folder. */
  cwd?: string;
}

/**
 * Everything that touches the OS goes through a Runner, so tests can
 * swap in a fake and never install real software.
 */
export interface Runner {
  /** Run a program with fixed arguments. Never goes through a shell with user input. */
  run(command: string, args?: string[], opts?: RunOptions): RunResult;
  /** Run a fixed PowerShell script. */
  powershell(script: string, opts?: RunOptions): RunResult;
  /** Resolve a command name to its full path, or null if not on PATH. */
  which(command: string): string | null;
  /** Reload PATH from the system after an install (Windows), so new tools are found. */
  refreshPath(): void;
}

const isWindows = process.platform === "win32";

// Arguments we pass to cmd.exe must be boring. This blocks &, |, ^, %, quotes, etc.
const SAFE_ARG = /^[\w.\-@:=/\\ +~,]+$/;

function toResult(r: ReturnType<typeof spawnSync>): RunResult {
  const stdout = (r.stdout ?? "").toString().trim();
  const stderr = (r.stderr ?? "").toString().trim();
  if (r.error) return { ok: false, code: null, stdout, stderr, error: r.error.message };
  return { ok: r.status === 0, code: r.status, stdout, stderr };
}

function stdio(opts?: RunOptions) {
  return opts?.inherit ? (["inherit", "inherit", "inherit"] as StdioOptions) : undefined;
}

export function which(command: string): string | null {
  const r = isWindows
    ? spawnSync("where.exe", [command], { encoding: "utf8" })
    : spawnSync("which", [command], { encoding: "utf8" });
  if (r.status !== 0 || !r.stdout) return null;
  const lines = r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!isWindows) return lines[0] ?? null;
  // `where` can list an extensionless npm shim first; prefer runnable files.
  return lines.find((l) => /\.(exe|cmd|bat|com)$/i.test(l)) ?? lines[0] ?? null;
}

export function run(command: string, args: string[] = [], opts?: RunOptions): RunResult {
  const base = { encoding: "utf8" as const, stdio: stdio(opts), maxBuffer: 64 * 1024 * 1024, cwd: opts?.cwd };
  if (!isWindows) return toResult(spawnSync(command, args, base));

  // Windows: `code`, `npm`, `npx` are .cmd shims that Node refuses to spawn
  // without a shell. Resolve the real path and run .cmd/.bat via cmd.exe with
  // validated, quoted arguments.
  const resolved = /[\\/]/.test(command) ? command : which(command);
  if (!resolved) return { ok: false, code: null, stdout: "", stderr: "", error: `${command}: not found` };

  if (/\.(cmd|bat)$/i.test(resolved)) {
    for (const a of args) {
      if (!SAFE_ARG.test(a)) throw new Error(`Refusing unsafe argument for ${command}: ${a}`);
    }
    const line = [resolved, ...args].map((p) => `"${p}"`).join(" ");
    return toResult(
      spawnSync("cmd.exe", ["/d", "/s", "/c", `"${line}"`], { ...base, windowsVerbatimArguments: true }),
    );
  }
  return toResult(spawnSync(resolved, args, base));
}

export function powershell(script: string, opts?: RunOptions): RunResult {
  const exe = isWindows ? "powershell.exe" : "pwsh";
  return toResult(
    spawnSync(exe, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script], {
      encoding: "utf8",
      stdio: stdio(opts),
    }),
  );
}

export function refreshPath(): void {
  if (!isWindows) return;
  const r = powershell(
    "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + [Environment]::GetEnvironmentVariable('Path','User')",
  );
  if (r.ok && r.stdout) process.env.Path = process.env.PATH = r.stdout;
}

export const systemRunner: Runner = { run, powershell, which, refreshPath };
