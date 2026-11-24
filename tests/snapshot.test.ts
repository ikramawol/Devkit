import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Runner, RunOptions, RunResult } from "../src/utils/run.js";
import { readBackupFile } from "../src/migrate/archive.js";
import {
  configFile, listSnapshots, loadConfig, snapshotName, takeSnapshot,
} from "../src/snapshot/snapshot.js";
import { CRON_MARK, parseTime, schedule, unschedule } from "../src/snapshot/schedule.js";
import { loadPassword, savePassword } from "../src/utils/secret-store.js";
import { silentLogger } from "../src/utils/logger.js";
import { findRecipe } from "../src/core/stack.js";
import { fakeRunner, ok, fail, tempPlatform } from "./helpers.js";

/** Records every call with its stdin; `answer` decides the result. */
function recorder(installed: string[], answer: (line: string, input?: string) => RunResult = () => ok()) {
  const calls: { line: string; input?: string }[] = [];
  const runner: Runner = {
    which: (c) => (installed.includes(c) ? `/usr/bin/${c}` : null),
    refreshPath: () => {},
    run: (cmd: string, args: string[] = [], o?: RunOptions) => {
      const line = `${cmd} ${args.join(" ")}`;
      calls.push({ line, input: o?.input });
      return answer(line, o?.input);
    },
    powershell: (s: string, o?: RunOptions) => {
      calls.push({ line: `ps ${s}`, input: o?.input });
      return answer(`ps ${s}`, o?.input);
    },
  };
  return { runner, calls };
}

const PASSWORD = "  correct horse battery  "; // spaces at both ends must survive

// ── Snapshot files ──────────────────────────────────────────

test("snapshot names sort by time, and only dkit's own files are listed", () => {
  assert.equal(snapshotName("My PC!", new Date(2026, 10, 21, 9, 5, 7)), "snapshot-my-pc-20261121-090507.dkit");
  const { home } = tempPlatform("linux");
  writeFileSync(path.join(home, snapshotName("pc", new Date(2026, 0, 2))), "x");
  writeFileSync(path.join(home, snapshotName("pc", new Date(2026, 0, 3))), "x");
  writeFileSync(path.join(home, "my-notes.dkit"), "x");
  assert.deepEqual(listSnapshots(home).map((s) => s.name), ["snapshot-pc-20260103-000000.dkit", "snapshot-pc-20260102-000000.dkit"]);
});

test("takeSnapshot writes an encrypted backup and keeps only the newest `keep`", async () => {
  const platform = tempPlatform("windows");
  const { runner } = fakeRunner({ installed: new Set(["git"]) });
  const folder = path.join(platform.home, "snaps");
  mkdirSync(folder, { recursive: true });
  writeFileSync(path.join(folder, "keep-me.txt"), "not a snapshot");
  const cfg = { folder, keep: 2 };
  const deps = { runner, platform, log: silentLogger, exists: () => false };

  for (let day = 1; day <= 4; day++) takeSnapshot(deps, cfg, PASSWORD, new Date(2026, 0, day));
  const left = listSnapshots(folder);
  assert.deepEqual(left.map((s) => s.taken.getDate()), [4, 3]);
  assert.ok(existsSync(path.join(folder, "keep-me.txt")), "other files are never deleted");

  assert.ok(readFileSync(left[0].file).toString("latin1").startsWith("DKIT1"));
  const backup = await readBackupFile(left[0].file, async () => PASSWORD);
  assert.equal(backup.source.hostname, platform.hostname);
  await assert.rejects(readBackupFile(left[0].file, async () => "wrong password!"));
});

test("snapshot settings: sensible defaults, and a damaged settings file doesn't break anything", () => {
  const platform = tempPlatform("linux");
  assert.equal(loadConfig(platform).keep, 7);
  assert.equal(loadConfig(platform).folder, path.join(platform.home, ".dkit", "snapshots"));
  mkdirSync(path.dirname(configFile(platform)), { recursive: true });
  writeFileSync(configFile(platform), "{ broken");
  assert.equal(loadConfig(platform).keep, 7);
  writeFileSync(configFile(platform), JSON.stringify({ keep: -3, folder: 5 }));
  assert.equal(loadConfig(platform).keep, 7);
});

test("JSON files saved by Notepad or PowerShell 5 (with a byte-order mark) are read fine", () => {
  const platform = tempPlatform("windows");
  mkdirSync(path.dirname(configFile(platform)), { recursive: true });
  writeFileSync(configFile(platform), "\uFEFF" + JSON.stringify({ keep: 3, folder: "D:\\snaps" }));
  assert.equal(loadConfig(platform).keep, 3);

  const stacks = path.join(platform.home, ".dkit", "stacks");
  mkdirSync(stacks, { recursive: true });
  writeFileSync(path.join(stacks, "bom.json"), "\uFEFF" + JSON.stringify({ id: "bom", name: "BOM", machine: ["git"], libraries: [] }));
  assert.equal(findRecipe("bom", platform).name, "BOM");
});

// ── Password storage ────────────────────────────────────────

test("Windows: the password goes to DPAPI over stdin, never in the script", () => {
  const platform = tempPlatform("windows");
  let stored = "";
  const { runner, calls } = recorder([], (line, input) => {
    if (line.includes("ConvertFrom-SecureString")) { stored = input!; return ok("01000000d08c9ddf"); } // DPAPI hex
    if (line.includes("SecureStringToBSTR")) return ok(stored);
    return ok();
  });
  assert.equal(savePassword(PASSWORD, runner, platform), "dpapi");
  assert.ok(calls.every((c) => !c.line.includes("correct horse")), "not on any command line");
  assert.equal(readFileSync(path.join(platform.home, ".dkit", "snapshot-password.dpapi"), "utf8"), "01000000d08c9ddf");
  assert.equal(loadPassword("dpapi", runner, platform), PASSWORD);
});

test("macOS: Keychain, with the secret sent as hex through `security -i` stdin", () => {
  const platform = tempPlatform("macos");
  let hex = "";
  const { runner, calls } = recorder([], (line, input) => {
    if (line === "security -i") { hex = input!.match(/-X ([0-9a-f]+)/)![1]; return ok(); }
    if (line.startsWith("security find-generic-password")) return ok(Buffer.from(hex, "hex").toString());
    return ok();
  });
  assert.equal(savePassword(PASSWORD, runner, platform), "keychain");
  assert.ok(calls.every((c) => !c.line.includes("correct horse") && !c.input?.includes("correct horse")));
  assert.equal(loadPassword("keychain", runner, platform), PASSWORD);
});

test("Linux: the keyring through secret-tool; with no keyring, a private file", () => {
  const platform = tempPlatform("linux");
  let stored = "";
  const withKeyring = recorder(["secret-tool"], (line, input) => {
    if (line.startsWith("secret-tool store")) { stored = input!; return ok(); }
    if (line.startsWith("secret-tool lookup")) return ok(stored);
    return ok();
  });
  assert.equal(savePassword(PASSWORD, withKeyring.runner, platform), "secret-tool");
  assert.equal(loadPassword("secret-tool", withKeyring.runner, platform), PASSWORD);

  const lockedKeyring = recorder(["secret-tool"], () => fail("Cannot autolaunch D-Bus"));
  assert.equal(savePassword(PASSWORD, lockedKeyring.runner, platform), "file");
  assert.equal(loadPassword("file", lockedKeyring.runner, platform), PASSWORD);
  assert.equal(loadPassword("dpapi", lockedKeyring.runner, platform), null, "nothing saved there");
});

// ── Scheduling ──────────────────────────────────────────────

const cmd = { node: "/opt/node/bin/node", script: "/opt/dkit/dist/index.js" };

test("Windows: a Task Scheduler task that runs hidden and catches up after the PC was off", () => {
  const platform = tempPlatform("windows");
  const { runner, calls } = recorder([]);
  schedule({ every: "weekly", day: "mon", time: "09:30" }, cmd, runner, platform);
  const ps = calls[0].line;
  assert.match(ps, /Register-ScheduledTask -TaskName 'dkit snapshot'/);
  assert.match(ps, /-Weekly -DaysOfWeek Monday -At '09:30'/);
  assert.match(ps, /-Execute 'conhost\.exe' -Argument '--headless "\/opt\/node\/bin\/node" "\/opt\/dkit\/dist\/index\.js" "snapshot" "run" "--quiet"'/);
  assert.match(ps, /-StartWhenAvailable/);
  unschedule(runner, platform);
  assert.match(calls[1].line, /Unregister-ScheduledTask -TaskName 'dkit snapshot'/);
});

test("macOS: a launchd agent in ~/Library/LaunchAgents", () => {
  const platform = tempPlatform("macos");
  const { runner, calls } = recorder([]);
  schedule({ every: "weekly", day: "fri", time: "18:05" }, cmd, runner, platform);
  const plist = readFileSync(path.join(platform.home, "Library", "LaunchAgents", "com.devsetupkit.snapshot.plist"), "utf8");
  assert.match(plist, /<key>Hour<\/key><integer>18<\/integer><key>Minute<\/key><integer>5<\/integer><key>Weekday<\/key><integer>5<\/integer>/);
  assert.match(plist, /<string>\/opt\/dkit\/dist\/index\.js<\/string><string>snapshot<\/string><string>run<\/string><string>--quiet<\/string>/);
  assert.ok(calls.some((c) => c.line.startsWith("launchctl bootstrap gui/")));
  assert.equal(unschedule(runner, platform), true);
  assert.ok(!existsSync(path.join(platform.home, "Library", "LaunchAgents", "com.devsetupkit.snapshot.plist")));
});

test("Linux: one marked crontab line; your other cron jobs are kept, an old dkit line is replaced", () => {
  const platform = tempPlatform("linux");
  let crontab = `0 3 * * * /home/me/backup.sh\n5 5 * * * old-dkit ${CRON_MARK}\n`;
  const { runner } = recorder(["crontab", "pgrep"], (line, input) => {
    if (line === "crontab -l") return ok(crontab);
    if (line === "crontab -") { crontab = input!; return ok(); }
    if (line === "crontab -r") { crontab = ""; return ok(); }
    return ok();
  });
  schedule({ every: "daily", time: "12:00" }, cmd, runner, platform);
  const lines = crontab.trim().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(lines[0], "0 3 * * * /home/me/backup.sh");
  assert.match(lines[1], new RegExp(`^0 12 \\* \\* \\* DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/\\d+/bus "/opt/node/bin/node" "/opt/dkit/dist/index.js" snapshot run --quiet ${CRON_MARK}$`));

  assert.equal(unschedule(runner, platform), true);
  assert.equal(crontab.trim(), "0 3 * * * /home/me/backup.sh");
  assert.throws(() => schedule({ every: "daily", time: "12:00" }, { ...cmd, script: "/opt/100%/dkit.js" }, runner, platform), /cron can't handle/);
  assert.throws(() => schedule({ every: "daily", time: "12:00" }, cmd, recorder([]).runner, platform), /needs cron/);
});

test("times must be 24-hour HH:MM", () => {
  assert.deepEqual(parseTime("7:05"), { h: 7, m: 5 });
  for (const bad of ["24:00", "12:60", "noon", "12", ""]) assert.throws(() => parseTime(bad), bad);
});
