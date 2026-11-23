import { aptGet, wingetOk } from "../adapters/methods.js";
import { CATALOG, getItem, methodFor, requiresFor, type CatalogItem, type Method } from "../core/catalog.js";
import { clearWingetCache, detectItem, wingetInstalled, type DetectDeps, type ToolStatus } from "../core/detect.js";
import { isWindowsSidePath } from "../core/platform.js";
import type { Logger } from "../utils/logger.js";
import type { Runner, RunResult } from "../utils/run.js";

/**
 * Keeping installed tools current, and removing them, with the same installer dkit installs with
 * (winget, Homebrew, apt, npm). dkit only acts on a tool that installer actually has: something you
 * installed another way is left alone, with a note on how to handle it yourself.
 */

export type Task = "update" | "uninstall";

// ── Which installer has the tool ─────────────────────────────

const npmCache = new WeakMap<Runner, Set<string>>();

/** This system's own npm. In WSL, Windows' npm (/mnt/c/...) shows through on PATH: it manages Windows, not Linux. */
function hasNpm(deps: DetectDeps): boolean {
  const p = deps.runner.which("npm");
  return !!p && !(deps.platform.wsl && isWindowsSidePath(p));
}

/** Global npm packages, read once per run. */
function npmGlobals(deps: DetectDeps): Set<string> {
  const { runner } = deps;
  if (!npmCache.has(runner)) {
    const r = hasNpm(deps) ? runner.run("npm", ["ls", "-g", "--depth=0", "--json"]) : null;
    let names: string[] = [];
    try { names = Object.keys((JSON.parse(r?.stdout || "{}") as { dependencies?: object }).dependencies ?? {}); } catch { /* unreadable: none */ }
    npmCache.set(runner, new Set(names));
  }
  return npmCache.get(runner)!;
}

const brewName = (m: Extract<Method, { type: "brew" }>) => (m.cask ?? m.formula)!;

/**
 * The name the installer knows this tool by (the winget id actually installed, the brew formula...),
 * or null if this installer didn't install it. Script installs count as theirs once the tool is found.
 */
export function managedName(method: Method, deps: DetectDeps): string | null {
  const { runner } = deps;
  switch (method.type) {
    case "winget": {
      const ids = [method.id, ...(method.also ?? [])];
      const installed = wingetInstalled(runner);
      if (!installed) return method.id; // winget couldn't list its apps: let winget itself decide
      return ids.find((id) => installed.has(id.toLowerCase())) ?? null;
    }
    case "brew": {
      if (!runner.which("brew")) return null;
      const r = runner.run("brew", ["list", "--versions", ...(method.cask ? ["--cask"] : []), brewName(method)]);
      return r.ok && r.stdout.trim() ? brewName(method) : null;
    }
    case "apt": {
      const pkg = method.packages[0];
      const r = runner.which("dpkg-query") ? runner.run("dpkg-query", ["-W", "-f=${Status}", pkg]) : null;
      return r?.ok && r.stdout.includes("install ok installed") ? pkg : null;
    }
    case "npm":
      return npmGlobals(deps).has(method.pkg) ? method.pkg : null;
    case "script":
      return "script";
    default:
      return null;
  }
}

/** How this tool is really installed here: its usual method, or npm when it came from its npm package instead. */
export function actualMethod(item: CatalogItem, deps: DetectDeps): Method | undefined {
  const m = methodFor(item, deps.platform);
  if (m?.type === "script" && item.npmAlt && npmGlobals(deps).has(item.npmAlt)) return { type: "npm", pkg: item.npmAlt };
  return m;
}

const INSTALLER: Record<Method["type"], string> = {
  winget: "winget", brew: "Homebrew", apt: "apt", npm: "npm", script: "its installer script",
  "windows-capability": "Windows", bundled: "another tool", builtin: "the OS", manual: "a download",
};

// ── Checking for updates ─────────────────────────────────────

export interface Available { current: string; latest: string }
export interface UpdateInfo extends Available { id: string; name: string; via: string }

/**
 * `winget upgrade` prints a table. Columns are found from the header, then shifted by where the id
 * really starts in each row (long or wide-character names push it along). Versions can contain
 * spaces ("< 3.15.2"), so they're cut by column, not split on spaces.
 */
export function parseWingetUpgrade(text: string): Map<string, Available> {
  const out = new Map<string, Available>();
  // Lines end in \r\n; inside a line, a \r is the progress spinner being overwritten, so keep what's after it.
  const lines = text.split(/\r?\n/).map((l) => l.slice(l.lastIndexOf("\r") + 1).replace(/\s+$/, ""));
  const dash = lines.findIndex((l) => /^-{10,}$/.test(l.trim()));
  if (dash < 1) return out;
  const cols = [...lines[dash - 1].matchAll(/\S+/g)].map((m) => m.index!);
  if (cols.length < 4) return out;
  const [, idCol, verCol, availCol, srcCol] = cols;
  for (const row of lines.slice(dash + 1)) {
    if (!row.trim()) break; // a blank line ends the table
    const tokens = [...row.matchAll(/\S+/g)];
    const idTok = tokens.reduce((best, t) => (Math.abs(t.index! - idCol) < Math.abs(best.index! - idCol) ? t : best), tokens[0]);
    const shift = idTok.index! - idCol;
    const current = row.slice(verCol + shift, availCol + shift).trim();
    const latest = row.slice(availCol + shift, srcCol === undefined ? undefined : srcCol + shift).trim();
    if (current && latest) out.set(idTok[0].toLowerCase(), { current, latest });
  }
  return out;
}

/** `apt list --upgradable`: "git/noble-updates 1:2.43.0-1ubuntu7.2 amd64 [upgradable from: 1:2.43.0-1ubuntu7.1]" */
export function parseAptUpgradable(text: string): Map<string, Available> {
  const out = new Map<string, Available>();
  for (const m of text.matchAll(/^([^/\s]+)\/\S+\s+(\S+)\s+\S+\s+\[upgradable from: ([^\]]+)\]/gm)) out.set(m[1], { current: m[3], latest: m[2] });
  return out;
}

function parseJsonOr<T>(text: string, fallback: T): T {
  try { return text.trim() ? (JSON.parse(text) as T) : fallback; } catch { return fallback; }
}

/**
 * Updates the installers know about, for every catalog tool they installed. Asks each installer once.
 * apt answers from its last `apt update` (refreshing needs admin rights), so it can be a little behind.
 */
export function checkUpdates(deps: DetectDeps): { updates: UpdateInfo[]; errors: string[] } {
  const { runner, platform } = deps;
  const items = CATALOG.filter((i) => i.kind === "machine").map((item) => ({ item, method: methodFor(item, platform) }));
  const uses = (t: Method["type"]) => items.some((x) => x.method?.type === t);
  const errors: string[] = [];
  const lists: Partial<Record<Method["type"], Map<string, Available>>> = {};

  if (uses("winget") && runner.which("winget")) {
    const r = runner.run("winget", ["upgrade", "--accept-source-agreements", "--disable-interactivity"]);
    lists.winget = parseWingetUpgrade(r.stdout);
    if (!r.ok && !lists.winget.size) errors.push("winget couldn't check for updates");
  }
  if (uses("brew") && runner.which("brew")) {
    const r = runner.run("brew", ["outdated", "--json=v2"]);
    type Entry = { name: string; installed_versions?: string[]; current_version?: string };
    const data = parseJsonOr<{ formulae?: Entry[]; casks?: Entry[] }>(r.stdout, {});
    lists.brew = new Map([...(data.formulae ?? []), ...(data.casks ?? [])].map((e) => [e.name, { current: e.installed_versions?.[0] ?? "?", latest: e.current_version ?? "?" }]));
    if (!r.ok && !lists.brew.size) errors.push("Homebrew couldn't check for updates");
  }
  if (uses("apt") && runner.which("apt")) {
    lists.apt = parseAptUpgradable(runner.run("apt", ["list", "--upgradable"]).stdout);
  }
  if ((uses("npm") || items.some((x) => x.item.npmAlt)) && hasNpm(deps)) {
    // npm exits with 1 when something is outdated, but still prints the JSON.
    const data = parseJsonOr<Record<string, { current?: string; latest?: string }>>(runner.run("npm", ["outdated", "-g", "--json"]).stdout, {});
    lists.npm = new Map(Object.entries(data).filter(([, v]) => v.current && v.latest && v.current !== v.latest).map(([k, v]) => [k, { current: v.current!, latest: v.latest! }]));
  }

  const updates: UpdateInfo[] = [];
  for (const { item, method } of items) {
    if (!method) continue;
    // A tool installed from its npm package instead shows up in npm's list.
    const viaNpm = item.npmAlt ? lists.npm?.get(item.npmAlt) : undefined;
    if (viaNpm) { updates.push({ id: item.id, name: item.name, via: "npm", ...viaNpm }); continue; }
    const list = lists[method.type];
    if (!list) continue;
    const keys =
      method.type === "winget" ? [method.id, ...(method.also ?? [])].map((k) => k.toLowerCase())
      : method.type === "brew" ? [brewName(method)]
      : method.type === "apt" ? method.packages
      : method.type === "npm" ? [method.pkg] : [];
    const hit = keys.map((k) => list.get(k)).find(Boolean);
    if (hit) updates.push({ id: item.id, name: item.name, via: INSTALLER[method.type], ...hit });
  }
  return { updates, errors };
}

// ── Plans ────────────────────────────────────────────────────

/** One command to run. apt goes through sudo; scripts through their shell. */
export type Step =
  | { kind: "run"; command: string; args: string[] }
  | { kind: "apt"; args: string[] }
  | { kind: "script"; shell: "powershell" | "bash"; script: string };

export function describeStep(s: Step): string {
  if (s.kind === "run") return [s.command, ...s.args].join(" ");
  if (s.kind === "apt") return `sudo apt-get ${s.args.join(" ")}`;
  return s.script;
}

const WINGET_FLAGS = ["--exact", "--silent", "--accept-source-agreements", "--disable-interactivity"];

function updateStep(item: CatalogItem, m: Method, name: string): Step | null {
  switch (m.type) {
    case "winget": return { kind: "run", command: "winget", args: ["upgrade", "--id", name, ...WINGET_FLAGS, "--accept-package-agreements"] };
    case "brew": return { kind: "run", command: "brew", args: ["upgrade", ...(m.cask ? ["--cask"] : []), name] };
    case "apt": return { kind: "apt", args: ["install", "--only-upgrade", "-y", ...m.packages] };
    case "npm": return { kind: "run", command: "npm", args: ["install", "-g", `${m.pkg}@latest`] };
    case "script":
      return item.selfUpdate
        ? { kind: "run", command: item.selfUpdate[0], args: item.selfUpdate.slice(1) }
        : { kind: "script", shell: m.shell, script: m.script }; // the official installer always fetches the latest
    default: return null;
  }
}

function uninstallStep(m: Method, name: string): Step | null {
  switch (m.type) {
    case "winget": return { kind: "run", command: "winget", args: ["uninstall", "--id", name, ...WINGET_FLAGS] };
    case "brew": return { kind: "run", command: "brew", args: ["uninstall", ...(m.cask ? ["--cask"] : []), name] };
    // No -y: apt lists everything it would remove and asks you itself.
    case "apt": return { kind: "apt", args: ["remove", ...m.packages] };
    case "npm": return { kind: "run", command: "npm", args: ["uninstall", "-g", m.pkg] };
    default: return null;
  }
}

export interface MaintainPlan {
  task: Task;
  ready: { item: CatalogItem; status: ToolStatus; step: Step }[];
  /** Installed, but dkit can't do it here: why, and what to do instead. */
  cannot: { item: CatalogItem; reason: string }[];
  notInstalled: CatalogItem[];
  /** Ids that aren't tools on this computer (unknown, or project libraries). */
  unknown: string[];
  /** Uninstall: installed tools that need one being removed. */
  dependents: { item: CatalogItem; needs: string[] }[];
}

/** Why a tool can't be updated or removed here, for the methods dkit never runs either way. */
function cannotReason(task: Task, item: CatalogItem, m: Method | undefined, deps: DetectDeps): string | null {
  const verb = task === "update" ? "update" : "uninstall";
  const os = deps.platform.os;
  if (deps.platform.wsl && item.wslInstall) return `In WSL it comes from Windows: ${verb} it there.`;
  if (task === "uninstall" && item.keepOn?.[os]) return item.keepOn[os]!;
  if (!m) return "dkit doesn't support it on this OS.";
  switch (m.type) {
    case "bundled": {
      const parent = getItem(m.with)?.name ?? m.with;
      return task === "update" ? `It's updated together with ${parent}.` : `It comes with ${parent}: uninstall ${parent} to remove it.`;
    }
    case "builtin": return task === "update" ? "It's part of the OS and updates with it." : "It's part of the OS, so dkit won't remove it.";
    case "windows-capability": return task === "update" ? "Windows Update keeps it current." : "It's part of Windows.";
    case "manual": return `dkit didn't install it (it's a manual download): ${verb} it the way you installed it.`;
    case "script":
      if (task === "uninstall") return item.removeManually?.[os] ?? "It was installed with a script: remove it the way its website says.";
      return null;
    default: return null;
  }
}

export function planMaintenance(task: Task, ids: string[], deps: DetectDeps): MaintainPlan {
  const plan: MaintainPlan = { task, ready: [], cannot: [], notInstalled: [], unknown: [], dependents: [] };
  const os = deps.platform.os;
  const picked = new Set(ids);
  for (const id of ids) {
    const item = getItem(id);
    if (!item || item.kind !== "machine") plan.unknown.push(id);
  }
  // Catalog order, so the plan reads the same every time.
  for (const item of CATALOG.filter((i) => i.kind === "machine" && picked.has(i.id))) {
    const status = detectItem(item, deps);
    if (!status.installed) { plan.notInstalled.push(item); continue; }
    const m = actualMethod(item, deps);
    const reason = cannotReason(task, item, m, deps);
    if (reason) { plan.cannot.push({ item, reason }); continue; }
    const name = managedName(m!, deps);
    if (!name) {
      const where = status.where && status.where !== "winget" ? ` (it's at ${status.where})` : "";
      const how = os === "windows" ? " or in Settings → Apps" : "";
      plan.cannot.push({ item, reason: `It wasn't installed with ${INSTALLER[m!.type]}${where}: ${task === "update" ? "update" : "remove"} it the way you installed it${task === "uninstall" ? how : ""}.` });
      continue;
    }
    const step = task === "update" ? updateStep(item, m!, name) : uninstallStep(m!, name);
    if (step) plan.ready.push({ item, status, step });
    else plan.cannot.push({ item, reason: `dkit can't ${task} it automatically.` });
  }

  if (task === "uninstall" && plan.ready.length) {
    const removing = new Set(plan.ready.map((r) => r.item.id));
    // What a tool needs: its catalog requirements, plus Node.js for anything that came from npm.
    const needs = (i: CatalogItem) => [...new Set([...requiresFor(i, os), ...(actualMethod(i, deps)?.type === "npm" ? ["node"] : [])])];
    // Remove tools before what they need: an npm-installed tool needs npm to uninstall it.
    const needsOther = (i: CatalogItem) => needs(i).some((d) => removing.has(d));
    plan.ready.sort((a, b) => Number(needsOther(b.item)) - Number(needsOther(a.item)));
    for (const other of CATALOG.filter((i) => i.kind === "machine" && !removing.has(i.id))) {
      const broken = needs(other).filter((d) => removing.has(d));
      if (broken.length && detectItem(other, deps).installed) plan.dependents.push({ item: other, needs: broken });
    }
  }
  return plan;
}

// ── Running ──────────────────────────────────────────────────

export function runStep(step: Step, runner: Runner): { ok: boolean; message?: string } {
  const live = { inherit: true };
  if (step.kind === "apt") return aptGet(runner, step.args, step.args[0] !== "remove");
  let r: RunResult;
  if (step.kind === "script") r = step.shell === "powershell" ? runner.powershell(step.script, live) : runner.run("bash", ["-c", step.script], live);
  else r = runner.run(step.command, step.args, live);
  const ok = step.kind === "run" && step.command === "winget" ? wingetOk(r.code) : r.ok;
  return ok ? { ok } : { ok, message: r.error ?? `${step.kind === "run" ? step.command : "installer"} exited with ${r.code}` };
}

export type MaintainOutcome = "updated" | "up-to-date" | "removed" | "unverified" | "failed";
export interface MaintainResult { id: string; name: string; outcome: MaintainOutcome; before?: string; after?: string; message?: string }

/** Run each step, then check the result for real: the new version, or that the tool is gone. */
export function executeMaintenance(plan: MaintainPlan, deps: DetectDeps & { log: Logger }): MaintainResult[] {
  const { runner, log } = deps;
  const results: MaintainResult[] = [];
  for (const { item, status, step } of plan.ready) {
    log.step(`${plan.task === "update" ? "Updating" : "Uninstalling"} ${item.name}…`);
    const res = runStep(step, runner);
    runner.refreshPath();
    clearWingetCache(runner);
    const base = { id: item.id, name: item.name, before: status.version };
    if (!res.ok) {
      log.error(`${item.name}: ${res.message ?? "failed"}`);
      results.push({ ...base, outcome: "failed", message: res.message });
      continue;
    }
    const after = detectItem(item, deps);
    if (plan.task === "uninstall") {
      if (after.installed) log.warn(`${item.name}: the uninstaller finished, but it's still found (it may finish after a restart)`);
      else log.ok(`${item.name} removed`);
      results.push({ ...base, outcome: after.installed ? "unverified" : "removed" });
    } else {
      const changed = !!after.version && after.version !== status.version;
      if (changed) log.ok(`${item.name} ${status.version ?? "?"} → ${after.version}`);
      else log.ok(`${item.name} ${after.version ?? ""} ${after.version ? "(no newer version, or it applies after a restart)" : ""}`.trim());
      results.push({ ...base, after: after.version, outcome: changed ? "updated" : "up-to-date" });
    }
  }
  return results;
}
