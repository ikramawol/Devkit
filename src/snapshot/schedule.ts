import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PlatformInfo } from "../core/platform.js";
import type { Runner } from "../utils/run.js";

/**
 * Registers `dkit snapshot run --quiet` with the OS's own scheduler, for your user only (no admin):
 *   Windows  Task Scheduler task "dkit snapshot" (runs when you're signed in; catches up after the PC was off)
 *   macOS    launchd agent ~/Library/LaunchAgents/com.devsetupkit.snapshot.plist (catches up after sleep)
 *   Linux    a line in your crontab, marked "# dkit-snapshot"
 */

export type Every = "daily" | "weekly";
export const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
export type Day = (typeof DAYS)[number];

export interface When {
  every: Every;
  /** "HH:MM", 24-hour. */
  time: string;
  /** Weekly only. */
  day?: Day;
}

export const TASK_NAME = "dkit snapshot";
export const LAUNCHD_LABEL = "com.devsetupkit.snapshot";
export const CRON_MARK = "# dkit-snapshot";

/** The exact program and script to run later: this Node and this dkit, so the job works without PATH. */
export interface DkitCommand { node: string; script: string }

export function currentDkit(): DkitCommand {
  return { node: process.execPath, script: realpathSync(process.argv[1]) };
}

export function parseTime(t: string): { h: number; m: number } {
  const m = t.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) throw new Error(`"${t}" isn't a time. Use 24-hour HH:MM, e.g. 12:30.`);
  return { h: Number(m[1]), m: Number(m[2]) };
}

export function describeWhen(w: When): string {
  return w.every === "daily" ? `every day at ${w.time}` : `every ${w.day ?? "sun"} at ${w.time}`;
}

const launchdPlist = (p: PlatformInfo) => path.join(p.home, "Library", "LaunchAgents", `${LAUNCHD_LABEL}.plist`);
const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export interface ScheduleResult { where: string; notes: string[] }

export function schedule(w: When, cmd: DkitCommand, runner: Runner, platform: PlatformInfo): ScheduleResult {
  const { h, m } = parseTime(w.time);
  const day = w.day ?? "sun";
  const args = [cmd.script, "snapshot", "run", "--quiet"];

  if (platform.os === "windows") {
    // conhost --headless runs node without flashing a console window.
    const argLine = ["--headless", ...[cmd.node, ...args].map((a) => `"${a}"`)].join(" ");
    const trigger = w.every === "daily"
      ? `New-ScheduledTaskTrigger -Daily -At ${psQuote(w.time)}`
      : `New-ScheduledTaskTrigger -Weekly -DaysOfWeek ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][DAYS.indexOf(day)]} -At ${psQuote(w.time)}`;
    const r = runner.powershell([
      "$ErrorActionPreference = 'Stop'",
      `$a = New-ScheduledTaskAction -Execute 'conhost.exe' -Argument ${psQuote(argLine)}`,
      `$t = ${trigger}`,
      "$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 30)",
      `Register-ScheduledTask -TaskName ${psQuote(TASK_NAME)} -Action $a -Trigger $t -Settings $s -Description 'Backs up your developer setup (dkit snapshot run)' -Force | Out-Null`,
    ].join("; "));
    if (!r.ok) throw new Error(`Couldn't create the scheduled task: ${r.stderr || r.error}`);
    return { where: `Task Scheduler: "${TASK_NAME}"`, notes: ["Runs while you're signed in to Windows. If the PC was off at that time, it runs the next time you sign in."] };
  }

  if (platform.os === "macos") {
    const file = launchdPlist(platform);
    const cal = `<key>Hour</key><integer>${h}</integer><key>Minute</key><integer>${m}</integer>` +
      (w.every === "weekly" ? `<key>Weekday</key><integer>${DAYS.indexOf(day)}</integer>` : "");
    const plist = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">`,
      `<plist version="1.0"><dict>`,
      `<key>Label</key><string>${LAUNCHD_LABEL}</string>`,
      `<key>ProgramArguments</key><array>${[cmd.node, ...args].map((a) => `<string>${xml(a)}</string>`).join("")}</array>`,
      `<key>StartCalendarInterval</key><dict>${cal}</dict>`,
      `</dict></plist>`,
      "",
    ].join("\n");
    mkdirSync(path.dirname(file), { recursive: true });
    const domain = `gui/${process.getuid?.() ?? 501}`;
    runner.run("launchctl", ["bootout", `${domain}/${LAUNCHD_LABEL}`]); // replace an older one; fails harmlessly if none
    writeFileSync(file, plist);
    const r = runner.run("launchctl", ["bootstrap", domain, file]);
    if (!r.ok) throw new Error(`Couldn't load the launchd agent: ${r.stderr || r.error}`);
    return { where: `launchd: ${file}`, notes: ["If your Mac was asleep at that time, it runs when it wakes."] };
  }

  // Linux: cron. % is special in crontab and quotes would break the line, so such paths are refused.
  if (!runner.which("crontab")) throw new Error("Scheduling needs cron. Install it (Ubuntu/Debian: sudo apt install cron) and try again.");
  for (const p of [cmd.node, cmd.script]) if (/["%\n]/.test(p)) throw new Error(`Can't schedule: the path ${p} has characters cron can't handle.`);
  const uid = process.getuid?.() ?? 1000;
  // The keyring is reached over your session's D-Bus, which cron jobs don't get by default.
  const line = `${m} ${h} * * ${w.every === "weekly" ? DAYS.indexOf(day) : "*"} DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/${uid}/bus "${cmd.node}" "${cmd.script}" snapshot run --quiet ${CRON_MARK}`;
  const r = runner.run("crontab", ["-"], { input: [...cronWithout(runner), line, ""].join("\n") });
  if (!r.ok) throw new Error(`Couldn't update your crontab: ${r.stderr || r.error}`);
  const notes: string[] = [];
  if (platform.wsl) notes.push("In WSL, cron only runs while WSL is running, and the cron service may be off: start it with sudo service cron start.");
  else if (!runner.run("pgrep", ["-x", "cron"]).ok && !runner.run("pgrep", ["-x", "crond"]).ok) notes.push("The cron service doesn't seem to be running: start it with sudo systemctl enable --now cron");
  notes.push("cron doesn't catch up: if the computer is off at that time, that day's snapshot is skipped.");
  return { where: "your crontab (crontab -l)", notes };
}

/** Your crontab minus dkit's line. */
function cronWithout(runner: Runner): string[] {
  const r = runner.run("crontab", ["-l"]);
  return (r.ok ? r.stdout.split(/\r?\n/) : []).filter((l) => l.trim() && !l.includes(CRON_MARK));
}

export function unschedule(runner: Runner, platform: PlatformInfo): boolean {
  if (platform.os === "windows") {
    return runner.powershell(`Unregister-ScheduledTask -TaskName ${psQuote(TASK_NAME)} -Confirm:$false -ErrorAction Stop`).ok;
  }
  if (platform.os === "macos") {
    const file = launchdPlist(platform);
    if (!existsSync(file)) return false;
    runner.run("launchctl", ["bootout", `gui/${process.getuid?.() ?? 501}/${LAUNCHD_LABEL}`]);
    rmSync(file, { force: true });
    return true;
  }
  if (!runner.which("crontab")) return false;
  const before = runner.run("crontab", ["-l"]);
  if (!before.ok || !before.stdout.includes(CRON_MARK)) return false;
  const rest = cronWithout(runner);
  return runner.run("crontab", rest.length ? ["-"] : ["-r"], rest.length ? { input: [...rest, ""].join("\n") } : undefined).ok;
}

/** Whether the OS still has dkit's job (someone may have deleted it by hand). */
export function isScheduled(runner: Runner, platform: PlatformInfo): boolean {
  if (platform.os === "windows") return runner.powershell(`Get-ScheduledTask -TaskName ${psQuote(TASK_NAME)} -ErrorAction Stop | Out-Null`).ok;
  if (platform.os === "macos") return existsSync(launchdPlist(platform));
  const r = runner.which("crontab") ? runner.run("crontab", ["-l"]) : null;
  return !!r?.ok && r.stdout.includes(CRON_MARK);
}
