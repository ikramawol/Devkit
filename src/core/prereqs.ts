import type { Runner } from "../utils/run.js";
import type { OS } from "./platform.js";
import type { CatalogItem } from "./catalog.js";

/**
 * Something the OS must have before a tool can be installed or run,
 * which isn't a tool itself (e.g. Docker Desktop needs WSL 2).
 */
export type Prereq =
  /** Can't be fixed by dkit: the user must update Windows. */
  | { type: "windows-build"; min: number }
  /** Can't be fixed by dkit: must be turned on in BIOS/UEFI. */
  | { type: "virtualization" }
  /** Windows optional feature, turned on with an admin prompt. Usually needs a restart. */
  | { type: "windows-feature"; name: string; label: string }
  /** Windows Subsystem for Linux 2, installed with an admin prompt. Needs a restart. */
  | { type: "wsl" };

export interface PrereqCheck {
  prereq: Prereq;
  key: string;
  label: string;
  ok: boolean;
  /** dkit can set it up. False = the user has to (see `hint`). */
  fixable: boolean;
  hint?: string;
}

export interface FixResult {
  ok: boolean;
  restart: boolean;
  message?: string;
}

// Exit code an installer uses for "done, but restart Windows".
const RESTART = 3010;

export function prereqKey(p: Prereq): string {
  switch (p.type) {
    case "windows-build": return `windows-build:${p.min}`;
    case "windows-feature": return `windows-feature:${p.name}`;
    default: return p.type;
  }
}

export function prereqLabel(p: Prereq): string {
  switch (p.type) {
    case "windows-build": return `Windows build ${p.min} or newer`;
    case "virtualization": return "CPU virtualization turned on";
    case "windows-feature": return p.label;
    case "wsl": return "WSL 2";
  }
}

/** What dkit will do to set it up, for the plan. */
export function describeFix(p: Prereq): string {
  switch (p.type) {
    case "windows-feature": return "will turn on (admin prompt, restart)";
    case "wsl": return "will install (admin prompt, restart)";
    default: return "";
  }
}

export function prereqsFor(item: CatalogItem, os: OS): Prereq[] {
  return item.prereqs?.[os] ?? [];
}

export function checkPrereq(p: Prereq, runner: Runner): PrereqCheck {
  const base = { prereq: p, key: prereqKey(p), label: prereqLabel(p) };
  const ps = (script: string) => runner.powershell(script).stdout.trim();

  switch (p.type) {
    case "windows-build": {
      const build = Number.parseInt(ps("[Environment]::OSVersion.Version.Build"), 10);
      // If the build can't be read, don't block the install on it.
      const ok = Number.isNaN(build) || build >= p.min;
      return { ...base, ok, fixable: false, hint: `You have build ${build}. Update Windows (Settings > Windows Update).` };
    }
    case "virtualization": {
      // With a hypervisor already running, the CPU flag reads False, so HypervisorPresent counts too.
      const out = ps(
        "$cs = Get-CimInstance Win32_ComputerSystem; $cpu = Get-CimInstance Win32_Processor | Select-Object -First 1; " +
        "[bool]($cs.HypervisorPresent -or $cpu.VirtualizationFirmwareEnabled)",
      );
      return {
        ...base, ok: out === "True", fixable: false,
        hint: "Turn on Intel VT-x / AMD-V (\"SVM\" or \"Virtualization Technology\") in your BIOS/UEFI settings.",
      };
    }
    case "windows-feature": {
      // Win32_OptionalFeature works without admin. InstallState 1 = enabled.
      const state = ps(`(Get-CimInstance Win32_OptionalFeature -Filter "Name='${p.name}'").InstallState`);
      if (!state) return { ...base, ok: false, fixable: false, hint: "Not available on this edition of Windows." };
      return { ...base, ok: state === "1", fixable: true };
    }
    case "wsl": {
      // When WSL isn't installed, wsl.exe is a stub that prints a message (localized) with no version number.
      const out = ps(
        "$env:WSL_UTF8 = '1'; $o = wsl.exe --version 2>&1 | Out-String; " +
        "[bool]($LASTEXITCODE -eq 0 -and $o -match '\\d+\\.\\d+\\.\\d+')",
      );
      return { ...base, ok: out === "True", fixable: true };
    }
  }
}

/** Run a fixed script as admin (UAC prompt) and wait. Returns its exit code. */
function elevated(runner: Runner, inner: string): number | null {
  // `inner` is a catalog constant; it must not contain single quotes.
  const r = runner.powershell(
    `$p = Start-Process powershell -Verb RunAs -Wait -PassThru -ArgumentList '-NoProfile','-Command','${inner}'; exit $p.ExitCode`,
    { inherit: true },
  );
  return r.code;
}

export function fixPrereq(p: Prereq, runner: Runner): FixResult {
  let code: number | null;
  switch (p.type) {
    case "windows-feature":
      code = elevated(
        runner,
        `try { $r = Enable-WindowsOptionalFeature -Online -FeatureName ${p.name} -All -NoRestart -WarningAction SilentlyContinue; ` +
        `if ($r.RestartNeeded) { exit ${RESTART} } } catch { exit 1 }; exit 0`,
      );
      break;
    case "wsl":
      code = elevated(runner, `wsl.exe --install --no-distribution; if ($LASTEXITCODE -ne 0) { exit 1 }; exit ${RESTART}`);
      break;
    default:
      return { ok: false, restart: false, message: "needs to be done by hand" };
  }
  if (code === 0) return { ok: true, restart: false };
  if (code === RESTART) return { ok: true, restart: true };
  return { ok: false, restart: false, message: "the admin prompt was cancelled or the step failed" };
}

/** Check every prerequisite of a tool. `cache` shares results between tools in one run. */
export function checkPrereqs(item: CatalogItem, os: OS, runner: Runner, cache = new Map<string, PrereqCheck>()): PrereqCheck[] {
  return prereqsFor(item, os).map((p) => {
    const key = prereqKey(p);
    if (!cache.has(key)) cache.set(key, checkPrereq(p, runner));
    return cache.get(key)!;
  });
}
