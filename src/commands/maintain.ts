import type { Command } from "commander";
import { CATALOG, getItem } from "../core/catalog.js";
import { diagnose, type Finding } from "../maintain/diagnose.js";
import {
  checkUpdates, describeStep, executeMaintenance, planMaintenance, type MaintainPlan, type MaintainResult, type UpdateInfo,
} from "../maintain/maintain.js";
import { c, type Logger } from "../utils/logger.js";
import { makeContext, type CommonOpts } from "./context.js";

const machineIds = () => CATALOG.filter((i) => i.kind === "machine").map((i) => i.id);
const arrow = (u: { current: string; latest: string }) => `${u.current} → ${u.latest}`;

function printPlan(plan: MaintainPlan, log: Logger, updates: Map<string, UpdateInfo>) {
  const verb = plan.task === "update" ? "update" : "uninstall";
  if (plan.ready.length) {
    log.info(c.bold(`Will ${verb}:`));
    for (const { item, status, step } of plan.ready) {
      const u = updates.get(item.id);
      const version = u ? arrow(u) : status.version ?? "";
      log.info(`  • ${item.name.padEnd(20)} ${version.padEnd(24)} ${c.dim(describeStep(step))}`);
    }
  }
  if (plan.dependents.length) {
    log.warn(c.bold("These need what you're removing and will stop working:"));
    for (const d of plan.dependents) log.info(`  • ${d.item.name} ${c.dim(`(needs ${d.needs.map((id) => getItem(id)?.name ?? id).join(", ")})`)}`);
  }
  if (plan.cannot.length) {
    log.info(c.bold(`\ndkit won't ${verb} these:`));
    for (const x of plan.cannot) log.info(`  • ${x.item.name}: ${c.dim(x.reason)}`);
  }
  if (plan.notInstalled.length) log.info(c.dim(`\nNot installed: ${plan.notInstalled.map((i) => i.name).join(", ")}`));
  if (plan.unknown.length) log.warn(`Not tools dkit knows: ${plan.unknown.join(", ")} (see \`dkit catalog\`; project libraries are updated with your package manager)`);
}

function printResults(results: MaintainResult[], log: Logger) {
  const names = (o: MaintainResult["outcome"]) => results.filter((r) => r.outcome === o);
  log.info(c.bold("\nSummary"));
  const line = (label: string, list: MaintainResult[], show: (r: MaintainResult) => string = (r) => r.name) =>
    list.length && log.info(`  ${label} ${list.map(show).join(", ")}`);
  line(c.green("Updated:"), names("updated"), (r) => `${r.name} ${r.before ?? "?"} → ${r.after}`);
  line(c.green("Already current:"), names("up-to-date"));
  line(c.green("Removed:"), names("removed"));
  line(c.yellow("Check after a restart:"), names("unverified"));
  line(c.red("Failed:"), names("failed"), (r) => `${r.name} (${r.message})`);
}

function printFinding(f: Finding) {
  const mark = f.level === "problem" ? c.red("✗") : c.yellow("!");
  console.log(`  ${mark} ${f.title}`);
  for (const l of f.lines ?? []) console.log(c.dim(`      ${l}`));
  if (f.fix) console.log(`      ${c.cyan("→")} ${f.fix}`);
}

export function registerMaintain(program: Command) {
  program
    .command("diagnose")
    .description("Find what's wrong or out of date: updates, duplicate installs, PATH mistakes (read-only)")
    .option("--offline", "skip the update check (it asks winget/Homebrew/apt/npm, which can take a while)")
    .option("--json", "output JSON")
    .action((opts: { offline?: boolean; json?: boolean }) => {
      const ctx = makeContext({});
      if (!opts.json) ctx.log.step(opts.offline ? "Checking your setup…" : "Checking your setup and looking for updates…");
      const report = diagnose(ctx, { updates: !opts.offline });
      if (opts.json) {
        console.log(JSON.stringify({ platform: ctx.platform, ...report }, null, 2));
        return;
      }
      console.log(c.bold(`\ndkit diagnose  ${c.dim(`${ctx.platform.os} ${ctx.platform.arch}`)}`));

      if (report.checkedUpdates) {
        console.log(`\n${c.bold("Updates")}`);
        if (!report.updates.length) console.log(`  ${c.green("✓")} Everything dkit can check is up to date`);
        for (const u of report.updates) console.log(`  ${c.cyan("↑")} ${u.name.padEnd(20)} ${arrow(u).padEnd(28)} ${c.dim(u.via)}`);
        for (const e of report.updateErrors) console.log(`  ${c.yellow("!")} ${e}`);
        if (!report.updates.some((u) => u.id === "claude")) console.log(c.dim("  Claude Code updates itself (or run `dkit update claude`)."));
      }

      const problems = report.findings.filter((f) => f.level === "problem");
      const notes = report.findings.filter((f) => f.level === "note");
      console.log(`\n${c.bold("Problems")}`);
      if (!problems.length) console.log(`  ${c.green("✓")} None found`);
      problems.forEach(printFinding);
      if (notes.length) {
        console.log(`\n${c.bold("Worth knowing")}`);
        notes.forEach(printFinding);
      }

      console.log();
      if (report.updates.length) console.log(`Update with: ${c.cyan(`dkit update ${report.updates.map((u) => u.id).join(" ")}`)}  ${c.dim("or `dkit update` to pick")}`);
      if (problems.length) process.exitCode = 1;
    });

  program
    .command("update [tools...]")
    .description("Update installed tools with the installer they came from. No names = pick from the ones with updates")
    .option("--all", "update every tool that has an update")
    .option("--dry-run", "show the plan without changing anything")
    .option("-y, --yes", "don't ask for confirmation")
    .addHelpText("after", `\nTools: ${machineIds().join(", ")}\n\nExamples:\n  dkit update\n  dkit update git node\n  dkit update --all --dry-run`)
    .action(async (tools: string[], opts: CommonOpts & { all?: boolean }) => {
      const ctx = makeContext(opts);
      let ids = tools.map((t) => t.toLowerCase());
      let updates = new Map<string, UpdateInfo>();

      if (!ids.length || opts.all) {
        ctx.log.step("Looking for updates…");
        const found = checkUpdates(ctx);
        for (const e of found.errors) ctx.log.warn(e);
        updates = new Map(found.updates.map((u) => [u.id, u]));
        if (!found.updates.length) {
          ctx.log.ok("Everything dkit can check is up to date.");
          ctx.log.info(c.dim("Claude Code updates itself; run `dkit update claude` to update it now."));
          return;
        }
        if (opts.all) ids = found.updates.map((u) => u.id);
        else if (opts.yes) {
          ctx.log.error("Name the tools to update, or use --all, when using --yes.");
          process.exitCode = 1;
          return;
        } else {
          ids = await ctx.select("Pick what to update", found.updates.map((u) => ({
            value: u.id, name: `${u.name.padEnd(20)} ${arrow(u).padEnd(28)} ${c.dim(u.via)}`, checked: true,
          })));
          if (!ids.length) return ctx.log.info("Nothing selected.");
        }
      }

      const plan = planMaintenance("update", ids, ctx);
      printPlan(plan, ctx.log, updates);
      if (!plan.ready.length) {
        if (plan.unknown.length || plan.cannot.length) process.exitCode = 1;
        return;
      }
      if (ctx.dryRun) return ctx.log.info(c.dim("\n[dry-run] nothing was changed"));
      if (!(await ctx.confirm(`\nUpdate ${plan.ready.length} tool(s)?`))) return ctx.log.warn("Cancelled. Nothing was changed.");
      const results = executeMaintenance(plan, ctx);
      printResults(results, ctx.log);
      if (results.some((r) => r.outcome === "failed")) process.exitCode = 1;
    });

  program
    .command("uninstall <tools...>")
    .description("Remove tools with the installer they came from. Your settings and data are left in place")
    .option("--dry-run", "show the plan without changing anything")
    .option("-y, --yes", "don't ask for confirmation")
    .addHelpText("after", "\nExamples:\n  dkit uninstall postman\n  dkit uninstall yarn --dry-run")
    .action(async (tools: string[], opts: CommonOpts) => {
      const ctx = makeContext(opts);
      const plan = planMaintenance("uninstall", tools.map((t) => t.toLowerCase()), ctx);
      printPlan(plan, ctx.log, new Map());
      if (!plan.ready.length) {
        if (plan.unknown.length || plan.cannot.length) process.exitCode = 1;
        return;
      }
      ctx.log.info(c.dim("\nOnly the programs are removed. Settings, projects and databases' data stay where they are."));
      if (ctx.dryRun) return ctx.log.info(c.dim("[dry-run] nothing was changed"));
      const names = plan.ready.map((r) => r.item.name).join(", ");
      if (!(await ctx.confirm(`\nUninstall ${names}?`))) return ctx.log.warn("Cancelled. Nothing was changed.");
      const results = executeMaintenance(plan, ctx);
      printResults(results, ctx.log);
      if (results.some((r) => r.outcome === "failed")) process.exitCode = 1;
    });
}
