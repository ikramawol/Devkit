import type { Method } from "../core/catalog.js";
import type { Runner } from "../utils/run.js";

export interface MethodResult {
  ok: boolean;
  /** True when nothing could be automated and the user must act (manual install). */
  manual?: boolean;
  message?: string;
}

// winget exit codes that mean "nothing to do", printed as signed or unsigned depending on Node/OS.
const WINGET_OK = new Set([0, 3010, -1978335189, 0x8a15002b, -1978335135, 0x8a150061]);
export const wingetOk = (code: number | null) => code !== null && WINGET_OK.has(code);

let aptUpdated = false;

/** Running as root (Linux/macOS)? Replaceable in tests. */
export let isRoot = () => process.getuid?.() === 0;
export function setIsRoot(fn: () => boolean) { isRoot = fn; }

/**
 * apt-get as root, or through sudo. With `refresh`, runs `apt-get update` first (once per dkit run).
 * Output is shown live, and apt can ask questions (uninstall doesn't pass -y, so apt shows what it removes).
 */
export function aptGet(runner: Runner, args: string[], refresh = true): MethodResult {
  const live = { inherit: true };
  if (!runner.which("apt-get")) return { ok: false, manual: true, message: "apt-get not found; use your distro's package manager" };
  // As root (containers, fresh servers) there's often no sudo, and none is needed.
  const root = isRoot();
  if (!root && !runner.which("sudo"))
    return { ok: false, manual: true, message: `needs admin rights: run as root, or install sudo (then: sudo apt-get ${args.join(" ")})` };
  const apt = (a: string[]) => (root ? runner.run("apt-get", a, live) : runner.run("sudo", ["apt-get", ...a], live));
  if (refresh && !aptUpdated) {
    apt(["update"]);
    aptUpdated = true;
  }
  const r = apt(args);
  return r.ok ? { ok: true } : { ok: false, message: r.error ?? `apt-get exited with ${r.code}` };
}

/** Human-readable form of what a method will do, for plans and --dry-run. */
export function describeMethod(m: Method): string {
  switch (m.type) {
    case "winget": return `winget install --id ${m.id}`;
    case "brew": return `brew install ${m.cask ? `--cask ${m.cask}` : m.formula}`;
    case "apt": return `sudo apt-get install ${m.packages.join(" ")}`;
    case "npm": return `npm install -g ${m.pkg}`;
    case "script": return m.script;
    case "windows-capability": return `Add-WindowsCapability ${m.name} (admin prompt)`;
    case "bundled": return `included with ${m.with}`;
    case "builtin": return "built into this OS";
    case "manual": return `download manually: ${m.url}`;
  }
}

export function runMethod(m: Method, runner: Runner): MethodResult {
  const live = { inherit: true };
  switch (m.type) {
    case "winget": {
      const r = runner.run("winget", [
        "install", "--id", m.id, "--exact", "--silent",
        "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity",
      ], live);
      return wingetOk(r.code)
        ? { ok: true }
        : { ok: false, message: r.error ?? `winget exited with ${r.code}` };
    }
    case "brew": {
      if (!runner.which("brew")) return { ok: false, manual: true, message: "Homebrew is required: https://brew.sh" };
      if (m.tap) {
        const t = runner.run("brew", ["tap", m.tap], live);
        if (!t.ok) return { ok: false, message: `brew tap ${m.tap} failed` };
      }
      const args = m.cask ? ["install", "--cask", m.cask] : ["install", m.formula!];
      const r = runner.run("brew", args, live);
      return r.ok ? { ok: true } : { ok: false, message: r.error ?? `brew exited with ${r.code}` };
    }
    case "apt":
      return aptGet(runner, ["install", "-y", ...m.packages]);
    case "npm": {
      const r = runner.run("npm", ["install", "-g", m.pkg], live);
      return r.ok ? { ok: true } : { ok: false, message: r.error ?? `npm exited with ${r.code}` };
    }
    case "script": {
      const r = m.shell === "powershell" ? runner.powershell(m.script, live) : runner.run("bash", ["-c", m.script], live);
      return r.ok ? { ok: true } : { ok: false, message: r.error ?? `installer exited with ${r.code}` };
    }
    case "windows-capability": {
      // Elevated child process: Windows shows a UAC prompt. The name is a fixed catalog constant.
      const inner = `Add-WindowsCapability -Online -Name ${m.name}`;
      const r = runner.powershell(
        `Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-Command','${inner}'`,
        live,
      );
      return r.ok ? { ok: true } : { ok: false, message: "admin step was cancelled or failed" };
    }
    case "bundled":
    case "builtin":
      return { ok: true };
    case "manual":
      return { ok: false, manual: true, message: m.url };
  }
}

/** Add a folder to the *user* PATH on Windows (no admin needed). Returns true if changed. */
export function addToUserPath(runner: Runner, dir: string): boolean {
  const current = runner.powershell("[Environment]::GetEnvironmentVariable('Path','User')");
  if (current.stdout.split(";").some((p) => p.trim().toLowerCase() === dir.toLowerCase())) return false;
  const safe = dir.replace(/'/g, "''");
  const r = runner.powershell(
    `$p = [Environment]::GetEnvironmentVariable('Path','User'); if (-not $p) { $p = '' }; ` +
    `[Environment]::SetEnvironmentVariable('Path', ($p.TrimEnd(';') + ';${safe}').TrimStart(';'), 'User')`,
  );
  return r.ok;
}
