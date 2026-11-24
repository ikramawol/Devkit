import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync, gzipSync } from "node:zlib";
import type { Backup } from "./bundle.js";
import { validateBackup } from "./restore.js";
import { parseJson } from "../utils/json.js";

/**
 * A .dkit backup file:
 *
 *   DKIT1\n
 *   {"enc":"aes-256-gcm","kdf":"scrypt","N":131072,...}\n   ← header, one line of JSON
 *   <bytes>                                                  ← gzip(backup JSON), encrypted unless enc is "none"
 *
 * Encrypted: AES-256-GCM, key from your password with scrypt (both built into Node).
 * GCM detects any change to the bytes, and the header is authenticated too, so a tampered
 * or damaged file is refused instead of half-restored.
 * Not encrypted: the header holds a SHA-256 of the bytes, so damage is still caught.
 */

const MAGIC = "DKIT1\n";
export const BACKUP_EXT = ".dkit";
export const MIN_PASSWORD = 8;

// scrypt cost: ~0.3 s and 128 MB per try, which makes guessing passwords slow.
const SCRYPT = { N: 2 ** 17, r: 8, p: 1 };
const MAXMEM = 256 * 1024 * 1024;

interface Header {
  enc: "aes-256-gcm" | "none";
  kdf?: "scrypt";
  N?: number;
  r?: number;
  p?: number;
  salt?: string;
  iv?: string;
  tag?: string;
  sha256?: string;
}

const deriveKey = (password: string, salt: Buffer, h: { N: number; r: number; p: number }) =>
  scryptSync(password.normalize("NFC"), salt, 32, { N: h.N, r: h.r, p: h.p, maxmem: MAXMEM });

/** The header line without the tag: what GCM authenticates alongside the data. */
const aad = (h: Header) => Buffer.from(JSON.stringify({ ...h, tag: undefined }));

export function packBackup(backup: Backup, password: string | null): Buffer {
  const data = gzipSync(Buffer.from(JSON.stringify(backup)), { level: 9 });
  let header: Header;
  let body: Buffer;
  if (password === null) {
    header = { enc: "none", sha256: createHash("sha256").update(data).digest("hex") };
    body = data;
  } else {
    if (password.length < MIN_PASSWORD) throw new Error(`The password must be at least ${MIN_PASSWORD} characters.`);
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    header = { enc: "aes-256-gcm", kdf: "scrypt", ...SCRYPT, salt: salt.toString("base64"), iv: iv.toString("base64") };
    const cipher = createCipheriv("aes-256-gcm", deriveKey(password, salt, SCRYPT), iv);
    cipher.setAAD(aad(header));
    body = Buffer.concat([cipher.update(data), cipher.final()]);
    header.tag = cipher.getAuthTag().toString("base64");
  }
  return Buffer.concat([Buffer.from(MAGIC + JSON.stringify(header) + "\n"), body]);
}

export interface BackupFileInfo {
  encrypted: boolean;
  /** "dkit" for .dkit files, "json" for plain backups from dkit 0.2 and older. */
  kind: "dkit" | "json";
  size: number;
}

function parse(buf: Buffer): { header: Header; body: Buffer } | null {
  if (buf.subarray(0, MAGIC.length).toString() !== MAGIC) return null;
  const end = buf.indexOf(0x0a, MAGIC.length);
  if (end < 0) throw new Error("This backup is damaged (no header).");
  let header: Header;
  try {
    header = JSON.parse(buf.subarray(MAGIC.length, end).toString("utf8"));
  } catch (e) {
    throw new Error("This backup is damaged (bad header).", { cause: e });
  }
  if (header.enc !== "none" && header.enc !== "aes-256-gcm") throw new Error(`Unsupported backup encryption "${header.enc}". Update dkit.`);
  return { header, body: buf.subarray(end + 1) };
}

/** What kind of file this is, without needing the password. */
export function backupFileInfo(buf: Buffer): BackupFileInfo {
  const p = parse(buf);
  return { encrypted: p?.header.enc === "aes-256-gcm", kind: p ? "dkit" : "json", size: buf.length };
}

export class WrongPasswordError extends Error {
  constructor() {
    super("Wrong password, or the backup file is damaged.");
  }
}

/** Open a backup: a .dkit file (asking for the password only if it's encrypted) or an old plain .json backup. */
export async function unpackBackup(buf: Buffer, getPassword: () => Promise<string>): Promise<Backup> {
  const p = parse(buf);
  if (!p) {
    // dkit 0.2 and older wrote plain JSON.
    let data: unknown;
    try {
      data = parseJson(buf.toString("utf8"));
    } catch (e) {
      throw new Error("This isn't a dkit backup file.", { cause: e });
    }
    return validateBackup(data);
  }

  const { header: h, body } = p;
  let data: Buffer;
  if (h.enc === "none") {
    if (createHash("sha256").update(body).digest("hex") !== h.sha256) throw new Error("This backup is damaged (checksum mismatch).");
    data = body;
  } else {
    if (h.kdf !== "scrypt" || !h.N || !h.r || !h.p || !h.salt || !h.iv || !h.tag) throw new Error("This backup is damaged (bad header).");
    if (h.N > 2 ** 20 || h.r > 32 || h.p > 16) throw new Error("This backup asks for unreasonable decryption settings; refusing it.");
    const password = await getPassword();
    const key = deriveKey(password, Buffer.from(h.salt, "base64"), { N: h.N, r: h.r, p: h.p });
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(h.iv, "base64"));
    decipher.setAAD(aad(h));
    decipher.setAuthTag(Buffer.from(h.tag, "base64"));
    try {
      data = Buffer.concat([decipher.update(body), decipher.final()]);
    } catch {
      throw new WrongPasswordError();
    }
  }
  let json: unknown;
  try {
    json = JSON.parse(gunzipSync(data).toString("utf8"));
  } catch (e) {
    throw new Error("This backup is damaged (can't decompress it).", { cause: e });
  }
  return validateBackup(json);
}

export function writeBackupFile(file: string, backup: Backup, password: string | null) {
  writeFileSync(file, packBackup(backup, password));
}

/** Read a backup file; on a wrong password, asks again (up to 3 tries) when `retry` is set. */
export async function readBackupFile(file: string, getPassword: () => Promise<string>, retry = false): Promise<Backup> {
  const buf = readFileSync(file);
  for (let attempt = 1; ; attempt++) {
    try {
      return await unpackBackup(buf, getPassword);
    } catch (e) {
      if (!(e instanceof WrongPasswordError) || !retry || attempt >= 3) throw e;
      console.error(e.message);
    }
  }
}
