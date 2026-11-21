import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import {
  WrongPasswordError, backupFileInfo, packBackup, readBackupFile, unpackBackup, writeBackupFile,
} from "../src/migrate/archive.js";
import { compareFiles, compareMcp, damagedFiles, manifestOf } from "../src/migrate/compare.js";
import { createBackup } from "../src/migrate/export.js";
import { restoreBackup } from "../src/migrate/restore.js";
import { loadManifest } from "../src/manifest/manifest.js";
import { editorUserDir } from "../src/core/platform.js";
import { askNewPassword } from "../src/utils/prompt.js";
import { silentLogger } from "../src/utils/logger.js";
import { engineCtx, fakeRunner, ok, tempPlatform } from "./helpers.js";

function put(file: string, content: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/** A PC with VS Code settings, Claude Code config with an MCP server, and an SSH config. */
function pc() {
  const platform = tempPlatform("windows");
  put(path.join(editorUserDir(platform, "Code"), "settings.json"), `{ "editor.fontSize": 15 }`);
  put(path.join(platform.home, ".claude", "CLAUDE.md"), "Be brief.");
  put(path.join(platform.home, ".claude.json"), JSON.stringify({ mcpServers: { files: { command: "npx" } } }));
  put(path.join(platform.home, ".ssh", "config"), "Host gh\n  HostName github.com\n");
  const { runner } = fakeRunner({
    installed: new Set(["git", "code"]),
    responses: { "code --list-extensions": ok("esbenp.prettier-vscode"), "git config --global --list": ok("init.defaultbranch=main") },
  });
  const backup = createBackup({ runner, platform, log: silentLogger, exists: () => false });
  return { platform, runner, backup };
}

const tmpFile = (name: string) => path.join(mkdtempSync(path.join(os.tmpdir(), "dkit-arc-")), name);
const never = async (): Promise<string> => { throw new Error("should not ask for a password"); };

// ── The .dkit file ──────────────────────────────────────────

test("encrypted backup: opens with the right password, refuses the wrong one", async () => {
  const { backup } = pc();
  const buf = packBackup(backup, "correct horse");
  assert.equal(backupFileInfo(buf).encrypted, true);
  assert.ok(!buf.includes("editor.fontSize") && !buf.includes("Be brief"), "no settings readable in the file");
  assert.deepEqual(await unpackBackup(buf, async () => "correct horse"), JSON.parse(JSON.stringify(backup)));
  await assert.rejects(unpackBackup(buf, async () => "wrong horse!"), WrongPasswordError);
});

test("encrypted backup: any change to the file is detected", async () => {
  const { backup } = pc();
  const buf = packBackup(backup, "correct horse");
  const body = Buffer.from(buf);
  body[body.length - 5] ^= 1;
  await assert.rejects(unpackBackup(body, async () => "correct horse"), WrongPasswordError, "flipped bit in the data");

  const text = buf.toString("latin1");
  const header = text.slice(0, text.indexOf("\n", 6));
  const iv = JSON.parse(header.slice(6)).iv as string;
  const badIv = Buffer.from(text.replace(iv, Buffer.alloc(12, 7).toString("base64")), "latin1");
  await assert.rejects(unpackBackup(badIv, async () => "correct horse"), WrongPasswordError, "edited header");
});

test("a file that demands huge decryption memory is refused before asking for a password", async () => {
  const evil = Buffer.from(`DKIT1\n${JSON.stringify({ enc: "aes-256-gcm", kdf: "scrypt", N: 2 ** 30, r: 8, p: 1, salt: "a", iv: "a", tag: "a" })}\nxx`);
  await assert.rejects(unpackBackup(evil, never), /unreasonable/);
});

test("unencrypted .dkit: no password, compressed, damage detected", async () => {
  const { backup } = pc();
  const buf = packBackup(backup, null);
  assert.equal(backupFileInfo(buf).encrypted, false);
  assert.ok(buf.length < JSON.stringify(backup).length, "smaller than the JSON");
  assert.equal((await unpackBackup(buf, never)).source.hostname, backup.source.hostname);
  const bad = Buffer.from(buf);
  bad[bad.length - 3] ^= 1;
  await assert.rejects(unpackBackup(bad, never), /damaged/);
});

test("old plain .json backups still open, and other files are refused", async () => {
  const { backup } = pc();
  assert.equal((await unpackBackup(Buffer.from(JSON.stringify(backup)), never)).tools.length, backup.tools.length);
  assert.equal(backupFileInfo(Buffer.from("{}")).kind, "json");
  await assert.rejects(unpackBackup(Buffer.from("hello"), never), /isn't a dkit backup/);
  await assert.rejects(unpackBackup(gzipSync("x"), never), /isn't a dkit backup/);
});

test("passwords: at least 8 characters, typed twice", async () => {
  assert.throws(() => packBackup(pc().backup, "short"), /at least 8/);
  const answers = ["longenough1", "different!!", "longenough2", "longenough2"];
  assert.equal(await askNewPassword(async () => answers.shift()!, 8, {}), "longenough2", "asks again after a mismatch");
  assert.equal(await askNewPassword(never, 8, { DKIT_BACKUP_PASSWORD: "from-the-env" }), "from-the-env");
  await assert.rejects(askNewPassword(never, 8, { DKIT_BACKUP_PASSWORD: "short" }), /at least 8/);
});

test("a wrong password can be retried", async () => {
  const file = tmpFile("b.dkit");
  writeBackupFile(file, pc().backup, "correct horse");
  const tries = ["nope-nope", "correct horse"];
  const b = await readBackupFile(file, async () => tries.shift()!, true);
  assert.equal(b.format, "dkit-backup");
});

// ── Inspect / compare ───────────────────────────────────────

test("compare: files the backup would create, replace, or leave alone", async () => {
  const { backup } = pc();
  const fresh = tempPlatform("windows");
  assert.deepEqual([...new Set(compareFiles(backup, fresh).map((f) => f.state))], ["missing"], "nothing on a new PC yet");
  assert.deepEqual(compareMcp(backup, fresh), [{ name: "files", here: false }]);

  // After a real restore, every file is where compare looks for it.
  const { runner } = fakeRunner({ installed: new Set(["git"]) });
  const ctx = { ...engineCtx(runner, fresh), select: async () => [], sections: ["editors", "claude", "ssh"] as never };
  await restoreBackup(backup, ctx);
  assert.deepEqual([...new Set(compareFiles(backup, fresh).map((f) => f.state))], ["same"]);

  put(path.join(fresh.home, ".claude", "CLAUDE.md"), "Changed here.");
  const changed = compareFiles(backup, fresh).filter((f) => f.state === "different").map((f) => f.file.path);
  assert.deepEqual(changed, ["CLAUDE.md"]);
});

test("inspect finds damaged files", () => {
  const { backup } = pc();
  assert.deepEqual(damagedFiles(backup), []);
  backup.claude.files[0].base64 = Buffer.from("tampered").toString("base64");
  assert.deepEqual(damagedFiles(backup), [backup.claude.files[0].path]);
});

test("status reads an encrypted backup, and old backups without a manifest", async () => {
  const { backup } = pc();
  const file = tmpFile("b.dkit");
  writeBackupFile(file, backup, "correct horse");
  assert.deepEqual((await loadManifest(file, async () => "correct horse")).tools.map((t) => t.id), backup.tools);
  await assert.rejects(loadManifest(file), /needs a password/);

  const old = tmpFile("old.json");
  writeFileSync(old, JSON.stringify({ ...backup, manifest: undefined }));
  const m = await loadManifest(old);
  assert.deepEqual(m.tools, backup.tools.map((id) => ({ id })), "built from the old backup's tool list");
  assert.deepEqual(m.git, { "init.defaultbranch": ["main"] });
  assert.deepEqual(manifestOf(backup), backup.manifest);
  assert.ok(readFileSync(file).subarray(0, 6).toString() === "DKIT1\n");
});

test("restore leaves Git settings that already match alone", async () => {
  const { backup } = pc(); // has init.defaultbranch=main
  const { runner, calls } = fakeRunner({
    installed: new Set(["git"]),
    responses: { "git config --global --list": ok("init.defaultbranch=main") },
  });
  const ctx = { ...engineCtx(runner, tempPlatform("windows")), select: async () => [], sections: ["git"] as never };
  await restoreBackup(backup, ctx);
  assert.ok(!calls.some((c) => c.startsWith("git config --global init.defaultbranch")), calls.join("\n"));
});
