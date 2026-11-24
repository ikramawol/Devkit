import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PlatformInfo } from "../core/platform.js";
import type { Runner } from "./run.js";

/**
 * Keeps a backup password where only you can read it, so a scheduled snapshot (or a sync) can run with no one there to type it.
 * Two slots: "snapshot" (this PC's snapshots) and "sync" (the password every PC in a sync folder shares).
 *   Windows  DPAPI: encrypted with your Windows login, saved in ~/.dkit/<slot>-password.dpapi
 *   macOS    your login Keychain (item "dkit-backup-password", or "dkit-sync-password")
 *   Linux    the desktop keyring through secret-tool; with no keyring (servers, WSL), a file only you can read
 * The password always goes over stdin, never on a command line where other programs could see it.
 * It's stored base64-encoded so spaces at either end survive.
 */
export type StoreKind = "dpapi" | "keychain" | "secret-tool" | "file";
export type Slot = "snapshot" | "sync";

export const STORE_LABEL: Record<StoreKind, string> = {
  dpapi: "Windows DPAPI (encrypted with your Windows login)",
  keychain: "the macOS Keychain",
  "secret-tool": "your Linux keyring",
  file: "a file only your user can read (in ~/.dkit); no keyring was found",
};

const SERVICE: Record<Slot, string> = { snapshot: "dkit-backup-password", sync: "dkit-sync-password" };
const ACCOUNT = "dkit";

const encode = (pw: string) => Buffer.from(pw, "utf8").toString("base64");
const decode = (b64: string) => {
  const s = b64.trim();
  return /^[A-Za-z0-9+/]+={0,2}$/.test(s) ? Buffer.from(s, "base64").toString("utf8") : null;
};

const dpapiFile = (p: PlatformInfo, slot: Slot) => path.join(p.home, ".dkit", `${slot}-password.dpapi`);
const plainFile = (p: PlatformInfo, slot: Slot) => path.join(p.home, ".dkit", `${slot}-password`);

function writePrivate(file: string, text: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text, { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* Windows: the file inherits your profile's permissions */ }
}

/** Save the password. Returns where it went. */
export function savePassword(password: string, runner: Runner, platform: PlatformInfo, slot: Slot = "snapshot"): StoreKind {
  const b64 = encode(password);
  if (platform.os === "windows") {
    const r = runner.powershell(
      "$p = [Console]::In.ReadToEnd(); ConvertTo-SecureString -String $p -AsPlainText -Force | ConvertFrom-SecureString",
      { input: b64 },
    );
    if (!r.ok || !/^[0-9a-f]+$/i.test(r.stdout)) throw new Error(`Couldn't encrypt the password with DPAPI: ${r.stderr || r.error || "no output"}`);
    writePrivate(dpapiFile(platform, slot), r.stdout);
    return "dpapi";
  }
  if (platform.os === "macos") {
    // `security -i` reads the command from stdin; -X takes the secret as hex, so nothing needs quoting.
    const r = runner.run("security", ["-i"], { input: `add-generic-password -U -a ${ACCOUNT} -s ${SERVICE[slot]} -X ${Buffer.from(b64).toString("hex")}\n` });
    if (!r.ok || /error/i.test(r.stderr)) throw new Error(`Couldn't save the password in the Keychain: ${r.stderr || r.error}`);
    return "keychain";
  }
  if (runner.which("secret-tool")) {
    const r = runner.run("secret-tool", ["store", `--label=dkit ${slot} password`, "service", SERVICE[slot], "account", ACCOUNT], { input: b64 });
    if (r.ok) return "secret-tool";
  }
  writePrivate(plainFile(platform, slot), b64);
  return "file";
}

/** The saved password, or null if there isn't one (or it can't be read, e.g. the keyring is locked). */
export function loadPassword(kind: StoreKind, runner: Runner, platform: PlatformInfo, slot: Slot = "snapshot"): string | null {
  switch (kind) {
    case "dpapi": {
      if (!existsSync(dpapiFile(platform, slot))) return null;
      const r = runner.powershell(
        "$s = ConvertTo-SecureString ([Console]::In.ReadToEnd().Trim()); " +
        "[Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))",
        { input: readFileSync(dpapiFile(platform, slot), "utf8") },
      );
      return r.ok ? decode(r.stdout) : null;
    }
    case "keychain": {
      const r = runner.run("security", ["find-generic-password", "-a", ACCOUNT, "-s", SERVICE[slot], "-w"]);
      return r.ok ? decode(r.stdout) : null;
    }
    case "secret-tool": {
      const r = runner.run("secret-tool", ["lookup", "service", SERVICE[slot], "account", ACCOUNT]);
      return r.ok ? decode(r.stdout) : null;
    }
    case "file":
      return existsSync(plainFile(platform, slot)) ? decode(readFileSync(plainFile(platform, slot), "utf8")) : null;
  }
}

export function forgetPassword(kind: StoreKind, runner: Runner, platform: PlatformInfo, slot: Slot = "snapshot") {
  if (kind === "dpapi") rmSync(dpapiFile(platform, slot), { force: true });
  else if (kind === "file") rmSync(plainFile(platform, slot), { force: true });
  else if (kind === "keychain") runner.run("security", ["delete-generic-password", "-a", ACCOUNT, "-s", SERVICE[slot]]);
  else runner.run("secret-tool", ["clear", "service", SERVICE[slot], "account", ACCOUNT]);
}
