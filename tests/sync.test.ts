import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { findCloudFolders } from "../src/sync/cloud.js";
import {
  MACHINES, MARKER, checkSyncFolder, checkSyncPassword, createSyncFolder, listMachines, loadSyncConfig, machineName,
  openMachine, pushMachine, saveSyncConfig, syncFolderFor, validMachineName,
} from "../src/sync/sync.js";
import { loadPassword, savePassword } from "../src/utils/secret-store.js";
import { silentLogger } from "../src/utils/logger.js";
import { fakeRunner, ok, tempPlatform } from "./helpers.js";

const PASSWORD = "shared sync password";

// ── Finding cloud folders ───────────────────────────────────

test("Windows: OneDrive from its environment variables, Dropbox from info.json, Google Drive's drive letter", () => {
  const platform = tempPlatform("windows");
  const dirs = new Set(["C:\\Users\\me\\OneDrive", "D:\\Dropbox (Work)", "G:\\My Drive"]);
  const found = findCloudFolders(platform, {
    env: { OneDrive: "C:\\Users\\me\\OneDrive", OneDriveConsumer: "C:\\Users\\me\\OneDrive", LOCALAPPDATA: "C:\\Users\\me\\AppData\\Local" },
    exists: (p) => dirs.has(p),
    readFile: (p) => {
      if (p === "C:\\Users\\me\\AppData\\Local\\Dropbox\\info.json") return JSON.stringify({ business: { path: "D:\\Dropbox (Work)" } });
      throw new Error("no file");
    },
  });
  assert.deepEqual(found, [
    { provider: "OneDrive", path: "C:\\Users\\me\\OneDrive" }, // listed once although two variables point at it
    { provider: "Dropbox", path: "D:\\Dropbox (Work)" },
    { provider: "Google Drive", path: "G:\\My Drive" },
  ]);
});

test("macOS: apps under ~/Library/CloudStorage, plus iCloud Drive; Linux: Dropbox, or nothing", () => {
  const mac = tempPlatform("macos");
  const storage = path.posix.join(mac.home, "Library", "CloudStorage");
  const icloud = path.posix.join(mac.home, "Library", "Mobile Documents", "com~apple~CloudDocs");
  const there = new Set([`${storage}/OneDrive-Personal`, `${storage}/GoogleDrive-me/My Drive`, icloud]);
  const found = findCloudFolders(mac, {
    exists: (p) => there.has(p),
    listDir: (p) => (p === storage ? ["GoogleDrive-me", "OneDrive-Personal", ".DS_Store"] : []),
    readFile: () => { throw new Error("none"); },
  });
  assert.deepEqual(found.map((f) => f.provider), ["Google Drive", "OneDrive", "iCloud Drive"]);

  const linux = tempPlatform("linux");
  assert.deepEqual(findCloudFolders(linux, { exists: () => false, readFile: () => { throw new Error("none"); } }), []);
});

// ── The sync folder ─────────────────────────────────────────

test("sync folder: names, the marker, and pointing at either the cloud folder or dkit-sync itself", () => {
  assert.equal(machineName("Ikram's Laptop"), "ikram-s-laptop");
  assert.equal(validMachineName("../evil"), false);
  const { home } = tempPlatform("linux");
  const cloud = path.join(home, "OneDrive");
  mkdirSync(cloud);
  const dir = syncFolderFor(cloud);
  assert.equal(dir, path.join(cloud, "dkit-sync"));
  createSyncFolder(dir);
  assert.equal(syncFolderFor(dir), dir);
  assert.doesNotThrow(() => checkSyncFolder(dir));
  writeFileSync(path.join(dir, MARKER), JSON.stringify({ format: "dkit-sync", version: 9 }));
  assert.throws(() => checkSyncFolder(dir), /newer dkit/);
});

test("each PC pushes its own encrypted file; any PC with the password can read them all", async () => {
  const laptop = tempPlatform("windows");
  const desktop = tempPlatform("macos");
  const dir = path.join(laptop.home, "OneDrive", "dkit-sync");
  createSyncFolder(dir);
  const exists = () => false;
  const push = (platform: typeof laptop, machine: string) =>
    pushMachine({ runner: fakeRunner({ installed: new Set(["git", "node"]) }).runner, platform, log: silentLogger, exists }, { folder: dir, machine }, PASSWORD);

  const a = push(laptop, "laptop");
  push(desktop, "desktop");
  push(laptop, "laptop"); // pushing again replaces this PC's file

  // A cloud app's conflict copy and a temp file are never treated as PCs.
  writeFileSync(path.join(dir, MACHINES, "laptop (1).dkit"), "x");
  writeFileSync(path.join(dir, MACHINES, ".laptop.123.tmp"), "x");
  const { machines, ignored } = listMachines(dir);
  assert.deepEqual(machines.map((m) => m.name), ["desktop", "laptop"]);
  assert.deepEqual(ignored, ["laptop (1).dkit"]);
  assert.ok(!readdirSync(path.join(dir, MACHINES)).some((f) => f.startsWith(".laptop.") && f !== ".laptop.123.tmp"), "no temp file left behind");

  assert.ok(readFileSync(a.file).toString("latin1").startsWith("DKIT1"), "encrypted .dkit file");
  const backup = await openMachine(machines[0].file, PASSWORD);
  assert.equal(backup.source.os, "macos");
  assert.equal(await checkSyncPassword(dir, PASSWORD), true);
  assert.equal(await checkSyncPassword(dir, "not the password"), false);
});

test("a missing or empty sync folder is reported plainly", async () => {
  const platform = tempPlatform("linux");
  const deps = { runner: fakeRunner({ installed: new Set() }).runner, platform, log: silentLogger, exists: () => false };
  assert.throws(() => pushMachine(deps, { folder: path.join(platform.home, "gone"), machine: "pc" }, PASSWORD), /isn't there/);
  const empty = path.join(platform.home, "dkit-sync");
  createSyncFolder(empty);
  assert.equal(await checkSyncPassword(empty, PASSWORD), null, "nothing to check the password against yet");
});

test("settings: saved and read back; a broken file means not set up", () => {
  const platform = tempPlatform("linux");
  assert.equal(loadSyncConfig(platform), null);
  saveSyncConfig(platform, { folder: "/cloud/dkit-sync", machine: "laptop", store: "file" });
  assert.equal(loadSyncConfig(platform)?.machine, "laptop");
  writeFileSync(path.join(platform.home, ".dkit", "sync.json"), JSON.stringify({ folder: "/x", machine: "../evil" }));
  assert.equal(loadSyncConfig(platform), null);
});

// ── Passwords ───────────────────────────────────────────────

test("the sync password and the snapshot password are kept apart", () => {
  const platform = tempPlatform("linux");
  const { runner } = fakeRunner({ installed: new Set() }); // no keyring: private files
  savePassword("snapshot-pw", runner, platform);
  savePassword("sync-pw", runner, platform, "sync");
  assert.equal(loadPassword("file", runner, platform), "snapshot-pw");
  assert.equal(loadPassword("file", runner, platform, "sync"), "sync-pw");
  assert.ok(existsSync(path.join(platform.home, ".dkit", "sync-password")));
  assert.ok(existsSync(path.join(platform.home, ".dkit", "snapshot-password")), "the old snapshot file name is unchanged");

  // Windows keeps a separate DPAPI file per slot.
  const win = tempPlatform("windows");
  const winRunner = fakeRunner({ installed: new Set(), ps: { "ConvertFrom-SecureString": ok("01000000abc") } }).runner;
  savePassword("sync-pw", winRunner, win, "sync");
  assert.ok(existsSync(path.join(win.home, ".dkit", "sync-password.dpapi")));
  assert.ok(!existsSync(path.join(win.home, ".dkit", "snapshot-password.dpapi")));
});
