import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { PlatformInfo } from "../core/platform.js";
import type { Runner } from "./run.js";

/**
 * Keeps the snapshot password where only you can read it, so a scheduled snapshot can run with no one there to type it.
 *   Windows  DPAPI: encrypted with your Windows login, saved in ~/.dkit/snapshot-password.dpapi
 *   macOS    your login Keychain (item "dkit-backup-password")
 *   Linux    the desktop keyring through secret-tool; with no keyring (servers, WSL), a file only you can read
 * The password always goes over stdin, never on a command line where other programs could see it.
 * It's stored base64-encoded so spaces at either end survive.
 */
export type StoreKind = "dpapi" | "keychain" | "secret-tool" | "file";

export const STORE_LABEL: Record<StoreKind, string> = {
  dpapi: "Windows DPAPI (encrypted with your Windows login)",
  keychain: "the macOS Keychain",
  "secret-tool": "your Linux keyring",
  file: "a file only your user can read (~/.dkit/snapshot-password); no keyring was found",
};

const SERVICE = "dkit-backup-password";
const ACCOUNT = "dkit";

const encode = (pw: string) => Buffer.from(pw, "utf8").toString("base64");
const decode = (b64: string) => {
  const s = b64.trim();
  return /^[A-Za-z0-9+/]+={0,2}$/.test(s) ? Buffer.from(s, "base64").toString("utf8") : null;
};

const dpapiFile = (p: PlatformInfo) => path.join(p.home, ".dkit", "snapshot-password.dpapi");
const plainFile = (p: PlatformInfo) => path.join(p.home, ".dkit", "snapshot-password");

function writePrivate(file: string, text: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text, { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* Windows: the file inherits your profile's permissions */ }
}

/** Save the password. Returns where it went. */
export function savePassword(password: string, runner: Runner, platform: PlatformInfo): StoreKind {
  const b64 = encode(password);
  if (platform.os === "windows") {
    const r = runner.powershell(
      "$p = [Console]::In.ReadToEnd(); ConvertTo-SecureString -String $p -AsPlainText -Force | ConvertFrom-SecureString",
      { input: b64 },
    );
    if (!r.ok || !/^[0-9a-f]+$/i.test(r.stdout)) throw new Error(`Couldn't encrypt the password with DPAPI: ${r.stderr || r.error || "no output"}`);
    writePrivate(dpapiFile(platform), r.stdout);
    return "dpapi";
  }
  if (platform.os === "macos") {
    // `security -i` reads the command from stdin; -X takes the secret as hex, so nothing needs quoting.
    const r = runner.run("security", ["-i"], { input: `add-generic-password -U -a ${ACCOUNT} -s ${SERVICE} -X ${Buffer.from(b64).toString("hex")}\n` });
    if (!r.ok || /error/i.test(r.stderr)) throw new Error(`Couldn't save the password in the Keychain: ${r.stderr || r.error}`);
    return "keychain";
  }
  if (runner.which("secret-tool")) {
    const r = runner.run("secret-tool", ["store", "--label=dkit backup password", "service", SERVICE, "account", ACCOUNT], { input: b64 });
    if (r.ok) return "secret-tool";
  }
  writePrivate(plainFile(platform), b64);
  return "file";
}

/** The saved password, or null if there isn't one (or it can't be read, e.g. the keyring is locked). */
export function loadPassword(kind: StoreKind, runner: Runner, platform: PlatformInfo): string | null {
  switch (kind) {
    case "dpapi": {
      if (!existsSync(dpapiFile(platform))) return null;
      const r = runner.powershell(
        "$s = ConvertTo-SecureString ([Console]::In.ReadToEnd().Trim()); " +
        "[Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))",
        { input: readFileSync(dpapiFile(platform), "utf8") },
      );
      return r.ok ? decode(r.stdout) : null;
    }
    case "keychain": {
      const r = runner.run("security", ["find-generic-password", "-a", ACCOUNT, "-s", SERVICE, "-w"]);
      return r.ok ? decode(r.stdout) : null;
    }
    case "secret-tool": {
      const r = runner.run("secret-tool", ["lookup", "service", SERVICE, "account", ACCOUNT]);
      return r.ok ? decode(r.stdout) : null;
    }
    case "file":
      return existsSync(plainFile(platform)) ? decode(readFileSync(plainFile(platform), "utf8")) : null;
  }
}

export function forgetPassword(kind: StoreKind, runner: Runner, platform: PlatformInfo) {
  if (kind === "dpapi") rmSync(dpapiFile(platform), { force: true });
  else if (kind === "file") rmSync(plainFile(platform), { force: true });
  else if (kind === "keychain") runner.run("security", ["delete-generic-password", "-a", ACCOUNT, "-s", SERVICE]);
  else runner.run("secret-tool", ["clear", "service", SERVICE, "account", ACCOUNT]);
}
