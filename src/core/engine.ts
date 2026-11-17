import type { Logger } from "../utils/logger.js";
import type { Confirm } from "../utils/prompt.js";
import { c } from "../utils/logger.js";
import { addToUserPath, describeMethod, runMethod } from "../adapters/methods.js";
import { CATALOG, getItem, requiresFor, type CatalogItem } from "./catalog.js";
import { detectItem, type DetectDeps, type ToolStatus } from "./detect.js";

export interface EngineContext extends DetectDeps {
  log: Logger;
  confirm: Confirm;
  dryRun: boolean;
}

export interface InstallPlan {
  /** Items to install, dependencies first. */
  toInstall: CatalogItem[];
  /** Dependencies added automatically (not picked by the user). */
  addedDeps: string[];
  alreadyInstalled: ToolStatus[];
  /** Not automatable on this OS: id → download URL. */
  manual: { item: CatalogItem; url: string }[];
  unknown: string[];
}

export type Outcome = "installed" | "needs-new-terminal" | "unverified" | "failed" | "skipped";

export interface InstallReport {
  results: { id: string; name: string; outcome: Outcome; message?: string }[];
  notes: string[];
}

export function buildPlan(ids: string[], ctx: DetectDeps): InstallPlan {
  const os = ctx.platform.os;
  const plan: InstallPlan = { toInstall: [], addedDeps: [], alreadyInstalled: [], manual: [], unknown: [] };
  const statusCache = new Map<string, ToolStatus>();
  const status = (item: CatalogItem) => {
    if (!statusCache.has(item.id)) statusCache.set(item.id, detectItem(item, ctx));
    return statusCache.get(item.id)!;
  };
  const picked = new Set(ids);
  const visited = new Set<string>();

  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const item = getItem(id);
    if (!item) return void plan.unknown.push(id);

    const s = status(item);
    if (s.installed) return void plan.alreadyInstalled.push(s);

    for (const dep of requiresFor(item, os)) {
      visit(dep);
      const added = plan.toInstall.some((i) => i.id === dep);
      if (added && !picked.has(dep) && !plan.addedDeps.includes(dep)) plan.addedDeps.push(dep);
    }

    const method = item.install[os];
    if (!method) return void plan.manual.push({ item, url: "not available for this OS yet" });
    if (method.type === "manual") return void plan.manual.push({ item, url: method.url });
    plan.toInstall.push(item);
  };

  // Keep catalog order for a predictable plan.
  for (const item of CATALOG) if (picked.has(item.id)) visit(item.id);
  for (const id of ids) if (!getItem(id)) plan.unknown.push(id);
  return plan;
}

export function printPlan(plan: InstallPlan, ctx: EngineContext) {
  const { log } = ctx;
  const os = ctx.platform.os;
  for (const s of plan.alreadyInstalled) log.ok(`${s.name} ${c.dim(s.version ?? "already installed")}`);
  if (plan.toInstall.length) {
    log.info(c.bold("\nWill install:"));
    for (const item of plan.toInstall) {
      const dep = plan.addedDeps.includes(item.id) ? c.yellow(" (needed by another tool)") : "";
      log.info(`  • ${item.name}${dep}  ${c.dim(describeMethod(item.install[os]!))}`);
    }
  }
  if (plan.manual.length) {
    log.info(c.bold("\nInstall these yourself:"));
    for (const m of plan.manual) log.info(`  • ${m.item.name}  ${c.dim(m.url)}`);
  }
  if (plan.unknown.length) log.warn(`Unknown tool ids: ${plan.unknown.join(", ")} (see \`dkit list\`)`);
}

export async function executePlan(plan: InstallPlan, ctx: EngineContext): Promise<InstallReport> {
  const { runner, platform, log } = ctx;
  const report: InstallReport = { results: [], notes: [] };
  const failed = new Set<string>();

  for (const item of plan.toInstall) {
    const blockedBy = requiresFor(item, platform.os).find((d) => failed.has(d));
    if (blockedBy) {
      report.results.push({ id: item.id, name: item.name, outcome: "skipped", message: `${blockedBy} failed` });
      failed.add(item.id);
      continue;
    }

    log.step(`Installing ${item.name}…`);
    const res = runMethod(item.install[platform.os]!, runner);
    if (!res.ok) {
      log.error(`${item.name}: ${res.message ?? "failed"}`);
      report.results.push({ id: item.id, name: item.name, outcome: "failed", message: res.message });
      failed.add(item.id);
      continue;
    }

    // New installs change PATH; reload it so this run (and later npm installs) can see them.
    runner.refreshPath();
    const after = detectItem(item, ctx);
    let outcome: Outcome = after.installed ? "installed" : "unverified";

    // Claude Code lands in ~/.local/bin, which may not be on PATH yet.
    if (item.id === "claude" && after.installed && !runner.which("claude")) {
      if (platform.os === "windows") addToUserPath(runner, platform.claudeBinDir);
      else report.notes.push(`Add to your shell profile: export PATH="${platform.claudeBinDir}:$PATH"`);
      outcome = "needs-new-terminal";
    }

    if (outcome === "unverified") log.warn(`${item.name}: installer finished, but it isn't visible yet (may need a restart or new terminal)`);
    else log.ok(`${item.name} ${after.version ?? ""}`);
    report.results.push({ id: item.id, name: item.name, outcome });
    for (const n of item.notes ?? []) report.notes.push(`${item.name}: ${n}`);
  }
  return report;
}

export function printReport(report: InstallReport, plan: InstallPlan, log: Logger) {
  const by = (o: Outcome) => report.results.filter((r) => r.outcome === o).map((r) => r.name);
  log.info(c.bold("\nSummary"));
  const line = (label: string, names: string[]) => names.length && log.info(`  ${label} ${names.join(", ")}`);
  line(c.green("Installed:"), by("installed"));
  line(c.yellow("Open a new terminal for:"), by("needs-new-terminal"));
  line(c.yellow("Check after restart:"), by("unverified"));
  line(c.red("Failed:"), report.results.filter((r) => r.outcome === "failed").map((r) => `${r.name} (${r.message})`));
  line(c.red("Skipped:"), report.results.filter((r) => r.outcome === "skipped").map((r) => `${r.name} (${r.message})`));
  line("Install yourself:", plan.manual.map((m) => m.item.name));
  if (report.notes.length) {
    log.info(c.bold("\nNext steps"));
    for (const n of report.notes) log.info(`  • ${n}`);
  }
}

/** Plan → show → confirm → run → report. Shared by `install`, `claude` and `migrate restore`. */
export async function installTools(ids: string[], ctx: EngineContext): Promise<InstallReport | null> {
  const plan = buildPlan(ids, ctx);
  printPlan(plan, ctx);
  if (!plan.toInstall.length) {
    ctx.log.info("\nNothing to install.");
    return { results: [], notes: [] };
  }
  if (ctx.dryRun) {
    ctx.log.info(c.dim("\n[dry-run] nothing was changed"));
    return null;
  }
  if (!(await ctx.confirm(`\nInstall ${plan.toInstall.length} tool(s)?`))) {
    ctx.log.warn("Cancelled. Nothing was changed.");
    return null;
  }
  const report = await executePlan(plan, ctx);
  printReport(report, plan, ctx.log);
  return report;
}
