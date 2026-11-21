import { readFileSync } from "node:fs";
import type { OS } from "../core/platform.js";
import { CATALOG, getItem, type Method } from "../core/catalog.js";
import { detectItem, type DetectDeps } from "../core/detect.js";
import { PACKAGE_MANAGERS, detectInProject, type PackageManager, type ProjectInfo } from "../core/project.js";
import { EDITORS } from "../migrate/editors.js";
import { REDACTED } from "../migrate/bundle.js";
import { backupFileInfo, unpackBackup } from "../migrate/archive.js";
import { manifestOf } from "../migrate/compare.js";
import { validateBackup } from "../migrate/restore.js";
import {
  EXTENSION_ID, NPM_NAME, findSecretRefs, isSafeGitSetting, listExtensions, listNpmGlobals, readGitConfig,
  shareableGit, shellProfiles, type SecretRef, type ShellKind,
} from "./discover.js";

/**
 * A portable description of a developer setup: what you want, not how one OS installs it.
 * It holds catalog ids (not winget/brew package names), so the same file works on Windows, macOS and Linux.
 * Personal details (Git name/email, computer name, folder paths) and secret values are never in it.
 */
export interface Manifest {
  format: "dkit-manifest";
  version: 1;
  createdAt: string;
  source: { os: OS; arch: string };
  /** Machine tools (catalog ids) and the version found when scanned. */
  tools: { id: string; version?: string }[];
  editors: { id: string; extensions: string[] }[];
  /** Global npm packages that aren't catalog tools. */
  npmGlobals: string[];
  /** Global Git preferences, key → value(s). */
  git: Record<string, string[]>;
  /** Which shell profiles exist (their contents stay in backups). */
  shells: ShellKind[];
  /** Names of secrets the setup relies on. Never values. */
  secrets: SecretRef[];
  /** The project you scanned in, if any: its package manager and catalog libraries. */
  project?: { name?: string; pm: PackageManager; libraries: { id: string; version?: string }[] };
}

export interface ScanDeps extends DetectDeps {
  project?: ProjectInfo;
}

/**
 * Global npm packages that are really tools, not "other" packages: the catalog's npm installs,
 * Claude Code's npm package (the catalog installs it natively), and dkit itself (already there if you're running it).
 */
const catalogNpmPackages = () => new Set([
  ...CATALOG.flatMap((i) => Object.values(i.install)).flatMap((m) => (m?.type === "npm" ? [m.pkg] : [])),
  "@anthropic-ai/claude-code", "devsetupkit-cli",
]);

/** Look at this machine (and project) and describe it. Changes nothing. */
export function scanEnvironment(deps: ScanDeps): Manifest {
  const { runner, platform, project } = deps;
  const tools = CATALOG.filter((i) => i.kind === "machine")
    .map((i) => detectItem(i, deps))
    .filter((s) => s.installed)
    .map((s) => ({ id: s.id, ...(s.version ? { version: s.version } : {}) }));

  const editors: Manifest["editors"] = [];
  for (const ed of EDITORS) {
    const extensions = listExtensions(runner, ed.cli);
    if (extensions) editors.push({ id: ed.id, extensions });
  }

  const npmTools = catalogNpmPackages();
  const npmGlobals = (listNpmGlobals(runner, platform) ?? []).filter((n) => !npmTools.has(n));

  const manifest: Manifest = {
    format: "dkit-manifest",
    version: 1,
    createdAt: new Date().toISOString(),
    source: { os: platform.os, arch: platform.arch },
    tools,
    editors,
    npmGlobals,
    git: shareableGit(readGitConfig(runner) ?? []),
    shells: [...new Set(shellProfiles(platform).map((s) => s.kind))],
    secrets: findSecretRefs(platform),
  };
  if (project) {
    const libraries = CATALOG.filter((i) => i.kind === "project")
      .map((i) => detectInProject(i, project))
      .filter((s) => s.installed)
      .map((s) => ({ id: s.id, ...(s.version ? { version: s.version } : {}) }));
    // A folder with none of dkit's libraries (like dkit's own source) has nothing worth recording.
    if (libraries.length) manifest.project ={ ...(project.name ? { name: project.name } : {}), pm: project.pm, libraries };
  }
  return manifest;
}

// ── Reading a manifest ───────────────────────────────────────

const ID = /^[a-z0-9][a-z0-9-]{0,49}$/;
const VERSION = /^[\w.+-]{1,40}$/;
const GIT_KEY = /^[^\s=]{1,200}$/;
const SECRET_NAME = /^[\w.[\]-]{1,100}$/;
const OSES: OS[] = ["windows", "macos", "linux"];
const SHELLS: ShellKind[] = ["powershell", "bash", "zsh"];

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Check a manifest's shape before anything uses it. A manifest can come from someone else,
 * so every id, package name and Git key must look like one, or the file is refused.
 */
export function validateManifest(data: unknown, label = "manifest"): Manifest {
  // Typed explicitly so TypeScript knows nothing after a bad(...) call runs.
  const bad: (msg: string) => never = (msg) => { throw new Error(`${label}: ${msg}`); };
  if (!isObj(data) || data.format !== "dkit-manifest") bad("this is not a dkit manifest (make one with `dkit scan -o dkit-manifest.json`)");
  const m = data as unknown as Manifest;
  if (m.version !== 1) bad(`unsupported version ${String(m.version)}. Update dkit.`);
  if (!isObj(m.source) || !OSES.includes(m.source.os)) bad("source.os must be windows, macos or linux");

  const list = (v: unknown, what: string): unknown[] => (Array.isArray(v) ? v : bad(`${what} must be a list`));
  const checkResources = (v: unknown, what: string) => {
    for (const t of list(v, what)) {
      if (!isObj(t) || typeof t.id !== "string" || !ID.test(t.id)) bad(`${what}: ${JSON.stringify(t)} is not a valid id`);
      if (t.version !== undefined && (typeof t.version !== "string" || !VERSION.test(t.version))) bad(`${what}: bad version for ${t.id}`);
    }
  };
  checkResources(m.tools, "tools");
  for (const e of list(m.editors, "editors")) {
    if (!isObj(e) || typeof e.id !== "string" || !ID.test(e.id)) bad(`editors: ${JSON.stringify(e)} is not a valid editor`);
    for (const x of list(e.extensions, `editors.${e.id}.extensions`))
      if (typeof x !== "string" || !EXTENSION_ID.test(x)) bad(`"${String(x)}" is not an extension id`);
  }
  for (const n of list(m.npmGlobals, "npmGlobals"))
    if (typeof n !== "string" || !NPM_NAME.test(n)) bad(`"${String(n)}" is not an npm package name`);
  if (!isObj(m.git)) bad("git must be an object of key → values");
  for (const [k, vals] of Object.entries(m.git as Record<string, unknown>)) {
    if (!GIT_KEY.test(k)) bad(`"${k}" is not a Git setting name`);
    for (const v of list(vals, `git.${k}`)) if (typeof v !== "string" || v.length > 500 || /[\r\n]/.test(v)) bad(`git.${k}: bad value`);
  }
  for (const s of list(m.shells, "shells")) if (!SHELLS.includes(s as ShellKind)) bad(`unknown shell "${String(s)}"`);
  for (const s of list(m.secrets, "secrets")) {
    if (!isObj(s) || typeof s.name !== "string" || !SECRET_NAME.test(s.name) || typeof s.where !== "string" || !["env", "config"].includes(s.kind as string))
      bad(`secrets: ${JSON.stringify(s)} is not a secret reference`);
    if (JSON.stringify(s).includes(REDACTED) || Object.keys(s).some((k) => !["name", "where", "kind"].includes(k)))
      bad("secrets may only hold a name, where it's used, and its kind");
  }
  if (m.project !== undefined) {
    if (!isObj(m.project) || !PACKAGE_MANAGERS.includes(m.project.pm)) bad("project.pm must be npm, pnpm, yarn or bun");
    checkResources(m.project.libraries, "project.libraries");
  }
  return m;
}

/**
 * Read a manifest file, or the manifest inside a `dkit migrate export` backup
 * (.dkit, asking for the password if it's encrypted, or an old plain .json backup).
 */
export async function loadManifest(file: string, askPassword: () => Promise<string> = async () => {
  throw new Error("This backup is encrypted and needs a password.");
}): Promise<Manifest> {
  let buf: Buffer;
  try {
    buf = readFileSync(file);
  } catch (e) {
    throw new Error(`Can't read ${file}: no such file. Make one with \`dkit scan -o dkit-manifest.json\``, { cause: e });
  }
  if (backupFileInfo(buf).kind === "dkit") {
    const backup = await unpackBackup(buf, askPassword);
    return validateManifest(manifestOf(backup), file);
  }
  let data: unknown;
  try {
    data = JSON.parse(buf.toString("utf8"));
  } catch (e) {
    throw new Error(`Can't read ${file}: it isn't valid JSON`, { cause: e });
  }
  if (isObj(data) && data.format === "dkit-backup") return validateManifest(manifestOf(validateBackup(data)), file);
  return validateManifest(data, file);
}

// ── Comparing ────────────────────────────────────────────────

/** -1 if a is older than b, 0 if the same, 1 if newer. Compares numbers part by part (1.10 > 1.9). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.+-]/).map((n) => parseInt(n, 10) || 0);
  const pb = b.split(/[.+-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return Math.sign(d);
  }
  return 0;
}

/** How to update a tool yourself. dkit doesn't update tools yet (support level 5). */
export function upgradeHint(m: Method | undefined): string | undefined {
  switch (m?.type) {
    case "winget": return `winget upgrade --id ${m.id}`;
    case "brew": return `brew upgrade ${m.cask ?? m.formula}`;
    case "npm": return `npm install -g ${m.pkg}@latest`;
    case "apt": return `sudo apt-get install --only-upgrade ${m.packages.join(" ")}`;
    default: return undefined;
  }
}

export type ResourceState = "ok" | "older" | "missing" | "unavailable" | "unknown";

export interface ResourceDiff {
  id: string;
  name: string;
  state: ResourceState;
  have?: string;
  want?: string;
  /** For "older": the command that updates it. */
  hint?: string;
}

export interface Comparison {
  manifest: Manifest;
  tools: ResourceDiff[];
  /** Catalog tools on this PC that the manifest doesn't list. Informational only. */
  extra: { id: string; name: string }[];
  editors: { id: string; name: string; installed: boolean; total: number; missing: string[] }[];
  /** `checked` is false when npm isn't installed, so nothing could be compared. */
  npm: { checked: boolean; total: number; missing: string[] };
  git: {
    checked: boolean;
    total: number;
    missing: { key: string; values: string[]; safe: boolean }[];
    different: { key: string; have: string[]; want: string[] }[];
  };
  secrets: (SecretRef & { set?: boolean })[];
  /** Present when the manifest has a project. `here` is the project dkit is looking at, if any. */
  project?: { here?: ProjectInfo; pm: PackageManager; libraries: ResourceDiff[] };
}

export interface CompareDeps extends DetectDeps {
  project?: ProjectInfo;
  /** Environment variables to check secrets against (default: process.env). */
  env?: Record<string, string | undefined>;
}

/** Editor extensions, global npm packages and Git settings. Separate so they can be re-checked after tools are installed. */
export function compareSettings(m: Manifest, deps: DetectDeps): Pick<Comparison, "editors" | "npm" | "git"> {
  const { runner } = deps;
  const editors: Comparison["editors"] = [];
  for (const e of m.editors) {
    const def = EDITORS.find((d) => d.id === e.id);
    if (!def) continue;
    const have = listExtensions(runner, def.cli);
    const lower = new Set((have ?? []).map((x) => x.toLowerCase()));
    editors.push({
      id: e.id, name: def.name, installed: have !== null, total: e.extensions.length,
      missing: e.extensions.filter((x) => !lower.has(x.toLowerCase())),
    });
  }

  const npmHave = listNpmGlobals(runner, deps.platform);
  const npm = {
    checked: npmHave !== null,
    total: m.npmGlobals.length,
    missing: m.npmGlobals.filter((n) => !(npmHave ?? []).includes(n)),
  };

  const gitHave = readGitConfig(runner);
  const byKey = new Map<string, string[]>();
  for (const [k, v] of gitHave ?? []) byKey.set(k.toLowerCase(), [...(byKey.get(k.toLowerCase()) ?? []), v]);
  const git: Comparison["git"] = { checked: gitHave !== null, total: Object.keys(m.git).length, missing: [], different: [] };
  for (const [key, want] of Object.entries(m.git)) {
    const have = byKey.get(key.toLowerCase());
    if (!have) git.missing.push({ key, values: want, safe: want.length === 1 && isSafeGitSetting(key, want[0]) });
    else if ([...have].sort().join("\n") !== [...want].sort().join("\n")) git.different.push({ key, have, want });
  }

  return { editors, npm, git };
}

/** Compare this machine (and project) with a manifest. Read-only. */
export function compareManifest(m: Manifest, deps: CompareDeps): Comparison {
  const { platform } = deps;
  const env = deps.env ?? process.env;

  const tools: ResourceDiff[] = m.tools.map(({ id, version: want }) => {
    const item = getItem(id);
    if (!item || item.kind !== "machine") return { id, name: id, state: "unknown", want };
    const s = detectItem(item, deps);
    const method = item.install[platform.os];
    if (!s.installed) return { id, name: item.name, state: method ? "missing" : "unavailable", want };
    if (want && s.version && compareVersions(s.version, want) < 0)
      return { id, name: item.name, state: "older", have: s.version, want, hint: upgradeHint(method) };
    return { id, name: item.name, state: "ok", have: s.version, want };
  });

  const listed = new Set(m.tools.map((t) => t.id));
  const extra = CATALOG.filter((i) => i.kind === "machine" && !listed.has(i.id) && detectItem(i, deps).installed)
    .map((i) => ({ id: i.id, name: i.name }));

  const { editors, npm, git } = compareSettings(m, deps);

  const secrets = m.secrets.map((s) => (s.kind === "env" ? { ...s, set: !!env[s.name] && env[s.name] !== REDACTED } : { ...s }));

  const cmp: Comparison = { manifest: m, tools, extra, editors, npm, git, secrets };
  if (m.project) {
    const here = deps.project;
    const libraries: ResourceDiff[] = m.project.libraries.map(({ id, version: want }) => {
      const item = getItem(id);
      if (!item || item.kind !== "project") return { id, name: id, state: "unknown", want };
      const s = here ? detectInProject(item, here) : { installed: false, version: undefined };
      if (!s.installed) return { id, name: item.name, state: "missing", want };
      if (want && s.version && compareVersions(s.version, want) < 0) return { id, name: item.name, state: "older", have: s.version, want };
      return { id, name: item.name, state: "ok", have: s.version, want };
    });
    cmp.project = { here, pm: m.project.pm, libraries };
  }
  return cmp;
}

/** Everything that differs, as one number (0 = this PC matches the manifest). */
export function differenceCount(cmp: Comparison): number {
  const off = (d: ResourceDiff) => d.state !== "ok";
  return cmp.tools.filter(off).length
    + cmp.editors.reduce((n, e) => n + e.missing.length, 0)
    + cmp.npm.missing.length
    + cmp.git.missing.length + cmp.git.different.length
    + cmp.secrets.filter((s) => s.set === false).length
    + (cmp.project?.libraries.filter(off).length ?? 0);
}
