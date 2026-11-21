import type { Logger } from "../utils/logger.js";
import type { Confirm } from "../utils/prompt.js";
import { c } from "../utils/logger.js";
import { addToUserPath, describeMethod, runMethod } from "../adapters/methods.js";
import { CATALOG, getItem, requiresFor, type CatalogItem } from "./catalog.js";
import { clearWingetCache, detectItem, type DetectDeps, type ToolStatus } from "./detect.js";
import { checkPrereqs, describeFix, fixPrereq, type FixResult, type PrereqCheck } from "./prereqs.js";
import {
  addCommand, allPackages, describeAdd, detectInProject, pmRequires, readProject, type ProjectInfo,
} from "./project.js";

/** Which project project-level resources (Hono, Kysely...) go into. */
export interface ProjectTarget {
  /** The folder that was checked (the current folder, or --project). */
  projectDir?: string;
  /** Set when that folder has a package.json. */
  project?: ProjectInfo;
}

export interface EngineContext extends DetectDeps, ProjectTarget {
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
  /** OS prerequisites per tool id (only tools that have any on this OS). */
  prereqs: Record<string, PrereqCheck[]>;
  /** Already installed, but missing prerequisites that dkit will set up. */
  repair: CatalogItem[];
  /** Need a step only the user can do (BIOS, Windows update) before dkit can continue. */
  blocked: CatalogItem[];
  /** Project resources to add to `project`, after the machine tools. */
  projectAdd: CatalogItem[];
  project?: ProjectInfo;
  /** Project resources asked for, but there's no project to put them in. */
  needsProject: CatalogItem[];
}

export type Outcome = "installed" | "set-up" | "needs-new-terminal" | "unverified" | "failed" | "skipped";

export interface InstallReport {
  results: { id: string; name: string; outcome: Outcome; message?: string }[];
  notes: string[];
  /** Prerequisites that were set up but need Windows restarted to finish. */
  restartFor: string[];
}

const pendingPrereqs = (plan: InstallPlan, id: string) => (plan.prereqs[id] ?? []).filter((p) => !p.ok);

export function buildPlan(ids: string[], ctx: DetectDeps & ProjectTarget): InstallPlan {
  const os = ctx.platform.os;
  const plan: InstallPlan = {
    toInstall: [], addedDeps: [], alreadyInstalled: [], manual: [], unknown: [], prereqs: {}, repair: [], blocked: [],
    projectAdd: [], project: ctx.project, needsProject: [],
  };
  const statusCache = new Map<string, ToolStatus>();
  const status = (item: CatalogItem) => {
    if (!statusCache.has(item.id)) statusCache.set(item.id, detectItem(item, ctx));
    return statusCache.get(item.id)!;
  };
  const prereqCache = new Map<string, PrereqCheck>();
  const picked = new Set(ids);
  const visited = new Set<string>();

  /** Machine tools something needs: planned first, and marked as added when the user didn't pick them. */
  const visitDeps = (deps: string[]) => {
    for (const dep of deps) {
      visit(dep);
      const added = plan.toInstall.some((i) => i.id === dep);
      if (added && !picked.has(dep) && !plan.addedDeps.includes(dep)) plan.addedDeps.push(dep);
    }
  };

  const visit = (id: string) => {
    if (visited.has(id)) return;
    visited.add(id);
    const item = getItem(id);
    if (!item) return void plan.unknown.push(id);

    // Project resources go into package.json with the project's own package manager.
    if (item.kind === "project") {
      if (!ctx.project) return void plan.needsProject.push(item);
      const s = detectInProject(item, ctx.project);
      if (s.installed) return void plan.alreadyInstalled.push(s);
      visitDeps(pmRequires(ctx.project.pm));
      plan.projectAdd.push(item);
      return;
    }

    const checks = checkPrereqs(item, os, ctx.runner, prereqCache);
    if (checks.length) plan.prereqs[item.id] = checks;
    const blocked = checks.some((p) => !p.ok && !p.fixable);
    const needsSetup = checks.some((p) => !p.ok);

    const s = status(item);
    if (s.installed) {
      plan.alreadyInstalled.push(s);
      if (blocked) plan.blocked.push(item);
      else if (needsSetup) plan.repair.push(item);
      return;
    }
    if (blocked) return void plan.blocked.push(item);

    visitDeps(requiresFor(item, os));

    const method = (ctx.platform.wsl && item.wslInstall) || item.install[os];
    if (!method) return void plan.manual.push({ item, url: "not available for this OS yet" });
    if (method.type === "manual") return void plan.manual.push({ item, url: method.url });
    plan.toInstall.push(item);
  };

  // Keep catalog order for a predictable plan.
  for (const item of CATALOG) if (picked.has(item.id)) visit(item.id);
  for (const id of ids) if (!getItem(id)) plan.unknown.push(id);
  return plan;
}

/** ✓ done, ○ dkit will set it up, ✗ the user must do it. */
export function prereqLine(p: PrereqCheck): string {
  if (p.ok) return `${c.green("✓")} ${p.label}`;
  if (p.fixable) return `${c.yellow("○")} ${p.label.padEnd(30)} ${c.dim(describeFix(p.prereq))}`;
  return `${c.red("✗")} ${p.label.padEnd(30)} ${c.dim(p.hint ?? "")}`;
}

export function printPlan(plan: InstallPlan, ctx: EngineContext) {
  const { log } = ctx;
  const os = ctx.platform.os;
  for (const s of plan.alreadyInstalled) log.ok(`${s.name} ${c.dim(s.version ?? "already installed")}`);

  for (const item of plan.blocked) {
    const installed = plan.alreadyInstalled.some((s) => s.id === item.id);
    log.info(c.bold(`\n${item.name} ${installed ? "won't run" : "can't be installed"} until you fix the ✗ items:`));
    for (const p of plan.prereqs[item.id] ?? []) log.info(`  ${prereqLine(p)}`);
  }
  for (const item of [...plan.repair, ...plan.toInstall]) {
    if (!pendingPrereqs(plan, item.id).length) continue;
    log.info(c.bold(`\n${item.name} needs these set up first:`));
    for (const p of plan.prereqs[item.id]) log.info(`  ${prereqLine(p)}`);
  }

  if (plan.toInstall.length) {
    log.info(c.bold("\nWill install:"));
    for (const item of plan.toInstall) {
      const dep = plan.addedDeps.includes(item.id) ? c.yellow(" (needed by another tool)") : "";
      log.info(`  • ${item.name}${dep}  ${c.dim(describeMethod(item.install[os]!))}`);
    }
  }
  if (plan.projectAdd.length && plan.project) {
    const p = plan.project;
    log.info(c.bold(`\nWill add to ${p.name ?? p.dir}`) + c.dim(`  ${p.dir} · ${p.pm} (${p.pmReason})`));
    for (const item of plan.projectAdd) {
      const same = item.packages?.sameVersion ?? {};
      const devNames = (item.packages?.dev ?? []).map((d) => (same[d] ? `${d} (same version as ${same[d]})` : d));
      const dev = devNames.length ? c.dim(` + dev: ${devNames.join(", ")}`) : "";
      log.info(`  • ${item.name}  ${(item.packages?.deps ?? []).join(", ")}${dev}`);
    }
    for (const cmd of projectCommands(plan)) log.info(c.dim(`  runs: ${describeAdd(p.pm, cmd.packages, cmd.dev)}`));
  }
  if (plan.needsProject.length) {
    const where = ctx.projectDir ?? process.cwd();
    log.warn(
      `${plan.needsProject.map((i) => i.name).join(", ")} ${plan.needsProject.length === 1 ? "goes" : "go"} into a project, ` +
      `but there's no package.json in ${where}.\n` +
      `  cd into your project, or use --project <folder>.`,
    );
  }
  if (plan.manual.length) {
    log.info(c.bold("\nInstall these yourself:"));
    for (const m of plan.manual) log.info(`  • ${m.item.name}  ${c.dim(m.url)}`);
  }
  if (plan.unknown.length) log.warn(`Unknown tool ids: ${plan.unknown.join(", ")} (see \`dkit list\`)`);
}

/** One `add` for regular packages and one for dev packages, so the lockfile is updated once each. */
function projectCommands(plan: InstallPlan): { packages: string[]; dev: boolean }[] {
  const deps = [...new Set(plan.projectAdd.flatMap((i) => i.packages?.deps ?? []))];
  const dev = [...new Set(plan.projectAdd.flatMap((i) => i.packages?.dev ?? []))];
  return [
    ...(deps.length ? [{ packages: deps, dev: false }] : []),
    ...(dev.length ? [{ packages: dev, dev: true }] : []),
  ];
}

/**
 * Windows reports some failures as huge unsigned numbers (4294963219 is -4077, a reset connection).
 * Show the real code, and say what negative codes usually mean.
 */
export function exitText(code: number | null): string {
  if (code === null) return "an error";
  const signed = code > 0x7fffffff ? code - 0x100000000 : code;
  return signed < 0 ? `${signed} (usually a network problem: run the same command again)` : String(signed);
}

/** prisma → prisma@7.10.1 when it must match the @prisma/client already in the project. */
function pinSameVersion(plan: InstallPlan, packages: string[], project: ProjectInfo): string[] {
  const now = readProject(project.dir, { pm: project.pm });
  return packages.map((pkg) => {
    const other = plan.projectAdd.map((i) => i.packages?.sameVersion?.[pkg]).find(Boolean);
    const version = other ? now?.deps[other]?.replace(/^[\^~>=<\s]+/, "") : undefined;
    return version && /^[\w.+-]+$/.test(version) ? `${pkg}@${version}` : pkg;
  });
}

export async function executePlan(plan: InstallPlan, ctx: EngineContext): Promise<InstallReport> {
  const { runner, platform, log } = ctx;
  const report: InstallReport = { results: [], notes: [], restartFor: [] };
  const failed = new Set<string>(plan.blocked.map((i) => i.id));
  const fixed = new Map<string, FixResult>(); // shared between tools in this run

  /** Work through a tool's missing prerequisites, ticking each off. Returns an error message, or null when all are done. */
  const setUp = (item: CatalogItem): string | null => {
    const pending = pendingPrereqs(plan, item.id);
    if (!pending.length) return null;
    log.step(`Setting up what ${item.name} needs first…`);
    for (const p of pending) {
      let res = fixed.get(p.key);
      if (!res) {
        log.info(`  ${c.yellow("○")} ${p.label}… ${c.dim("(approve the admin prompt)")}`);
        res = fixPrereq(p.prereq, runner);
        fixed.set(p.key, res);
        if (res.ok && res.restart) report.restartFor.push(p.label);
      }
      if (!res.ok) {
        log.error(`${p.label}: ${res.message ?? "failed"}`);
        return `couldn't set up ${p.label}`;
      }
      log.info(`  ${c.green("✓")} ${p.label}${res.restart ? c.dim("  (restart Windows to finish)") : ""}`);
    }
    log.ok(`Everything ${item.name} needs is set up`);
    return null;
  };

  // Installed tools that were only missing prerequisites.
  for (const item of plan.repair) {
    const err = setUp(item);
    report.results.push({ id: item.id, name: item.name, outcome: err ? "failed" : "set-up", message: err ?? undefined });
  }

  for (const item of plan.toInstall) {
    const blockedBy = requiresFor(item, platform.os).find((d) => failed.has(d));
    if (blockedBy) {
      report.results.push({ id: item.id, name: item.name, outcome: "skipped", message: `${blockedBy} failed` });
      failed.add(item.id);
      continue;
    }

    const prereqError = setUp(item);
    if (prereqError) {
      report.results.push({ id: item.id, name: item.name, outcome: "failed", message: prereqError });
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
    clearWingetCache(runner);
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

  // ── Project resources, now that the package manager is surely installed ──
  if (plan.projectAdd.length && plan.project) {
    const p = plan.project;
    const missingTool = pmRequires(p.pm).find((d) => failed.has(d));
    if (missingTool) {
      for (const item of plan.projectAdd)
        report.results.push({ id: item.id, name: item.name, outcome: "skipped", message: `${missingTool} failed` });
    } else {
      runner.refreshPath();
      const errors: string[] = [];
      for (const cmd of projectCommands(plan)) {
        // Dev packages run after regular ones, so a version to match (e.g. @prisma/client's) is known by now.
        const packages = cmd.dev ? pinSameVersion(plan, cmd.packages, p) : cmd.packages;
        log.step(`Adding to ${p.name ?? p.dir}: ${describeAdd(p.pm, packages, cmd.dev)}`);
        const { command, args } = addCommand(p.pm, packages, cmd.dev);
        const r = runner.run(command, args, { inherit: true, cwd: p.dir });
        if (!r.ok) errors.push(r.error ?? `${p.pm} exited with ${exitText(r.code)}`);
      }
      // Verify against package.json itself rather than trusting exit codes.
      const after = readProject(p.dir, { pm: p.pm });
      for (const item of plan.projectAdd) {
        const s = after ? detectInProject(item, after) : undefined;
        if (s?.installed) {
          log.ok(`${item.name} ${s.version ?? ""}`);
          report.results.push({ id: item.id, name: item.name, outcome: "installed" });
          for (const n of item.notes ?? []) report.notes.push(`${item.name}: ${n}`);
          // e.g. Kysely without a database driver: say so, but only if the project really has none.
          const sug = item.suggests;
          if (sug && after && !sug.ids.some((id) => { const i = getItem(id); return i && detectInProject(i, after).installed; })) {
            report.notes.push(`${item.name} also needs ${sug.what}, e.g. ${sug.ids.map((id) => getItem(id)?.name ?? id).join(" or ")}: dkit install ${sug.ids[0]}`);
          }
        } else {
          const missing = allPackages(item).filter((pkg) => !(after && pkg in after.deps));
          const message = errors[0] ?? `${missing.join(", ")} not in package.json`;
          log.error(`${item.name}: ${message}`);
          report.results.push({ id: item.id, name: item.name, outcome: "failed", message });
        }
      }
    }
  }
  return report;
}

export function printReport(report: InstallReport, plan: InstallPlan, log: Logger) {
  const by = (o: Outcome) => report.results.filter((r) => r.outcome === o).map((r) => r.name);
  log.info(c.bold("\nSummary"));
  const line = (label: string, names: string[]) => names.length && log.info(`  ${label} ${names.join(", ")}`);
  line(c.green("Installed:"), by("installed"));
  line(c.green("Prerequisites set up:"), by("set-up"));
  line(c.yellow("Open a new terminal for:"), by("needs-new-terminal"));
  line(c.yellow("Check after restart:"), by("unverified"));
  line(c.red("Failed:"), report.results.filter((r) => r.outcome === "failed").map((r) => `${r.name} (${r.message})`));
  line(c.red("Skipped:"), report.results.filter((r) => r.outcome === "skipped").map((r) => `${r.name} (${r.message})`));
  line(c.red("Needs you first:"), plan.blocked.map((i) => i.name));
  line(c.red("No project to add to:"), plan.needsProject.map((i) => i.name));
  line("Install yourself:", plan.manual.map((m) => m.item.name));
  if (report.restartFor.length) {
    log.warn(c.bold(`Restart Windows to finish setting up: ${report.restartFor.join(", ")}`));
  }
  if (report.notes.length) {
    log.info(c.bold("\nNext steps"));
    for (const n of report.notes) log.info(`  • ${n}`);
  }
}

/** Plan → show → confirm → run → report. Shared by `install`, `claude` and `migrate restore`. */
export async function installTools(ids: string[], ctx: EngineContext): Promise<InstallReport | null> {
  const plan = buildPlan(ids, ctx);
  printPlan(plan, ctx);
  const noProject = plan.needsProject.map((i) => ({ id: i.id, name: i.name, outcome: "skipped" as const, message: "no project" }));
  if (!plan.toInstall.length && !plan.repair.length && !plan.projectAdd.length) {
    if (!noProject.length) ctx.log.info("\nNothing to install.");
    return { results: noProject, notes: [], restartFor: [] };
  }
  if (ctx.dryRun) {
    ctx.log.info(c.dim("\n[dry-run] nothing was changed"));
    return null;
  }
  const parts = [
    plan.toInstall.length ? `install ${plan.toInstall.length} tool(s)` : "",
    plan.projectAdd.length ? `add ${plan.projectAdd.length} to ${plan.project?.name ?? "the project"}` : "",
  ].filter(Boolean);
  const question = parts.length
    ? `\n${parts.join(" and ").replace(/^./, (ch) => ch.toUpperCase())}?`
    : `\nSet up what ${plan.repair.map((i) => i.name).join(", ")} needs?`;
  if (!(await ctx.confirm(question))) {
    ctx.log.warn("Cancelled. Nothing was changed.");
    return null;
  }
  const report = await executePlan(plan, ctx);
  report.results.push(...noProject);
  printReport(report, plan, ctx.log);
  return report;
}
