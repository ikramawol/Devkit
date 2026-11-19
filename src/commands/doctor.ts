import type { Command } from "commander";
import { CATALOG, CATEGORIES } from "../core/catalog.js";
import { detectItem } from "../core/detect.js";
import { describeMethod } from "../adapters/methods.js";
import { prereqLine } from "../core/engine.js";
import { LEVELS, maturityOf } from "../core/maturity.js";
import { checkPrereqs, type PrereqCheck } from "../core/prereqs.js";
import { c } from "../utils/logger.js";
import { describePackages, detectInProject } from "../core/project.js";
import { makeContext, resolveProject } from "./context.js";

export function registerDoctor(program: Command) {
  program
    .command("doctor")
    .alias("list")
    .description("Show every supported tool and whether it's installed (read-only)")
    .option("--json", "output JSON")
    .option("-p, --project <folder>", "also show which libraries this project has (default: the current folder)")
    .action((opts: { json?: boolean; project?: string }) => {
      const ctx = makeContext({});
      const { project } = resolveProject({ project: opts.project });
      const cache = new Map<string, PrereqCheck>();
      const statuses = CATALOG.filter((i) => i.kind === "machine").map((i) => ({
        item: i,
        status: detectItem(i, ctx),
        prereqs: checkPrereqs(i, ctx.platform.os, ctx.runner, cache),
      }));

      if (opts.json) {
        const tools = statuses.map((s) => ({
          ...s.status,
          prereqs: s.prereqs.map(({ key, label, ok, fixable, hint }) => ({ key, label, ok, fixable, hint: ok ? undefined : hint })),
        }));
        const libraries = project ? CATALOG.filter((i) => i.kind === "project").map((i) => detectInProject(i, project)) : [];
        const proj = project ? { dir: project.dir, pm: project.pm, libraries } : null;
        console.log(JSON.stringify({ platform: ctx.platform, tools, project: proj }, null, 2));
        return;
      }

      console.log(c.bold(`dkit doctor  ${c.dim(`${ctx.platform.os} ${ctx.platform.arch}`)}`));
      for (const cat of CATEGORIES) {
        const inCat = statuses.filter((s) => s.item.category === cat);
        if (!inCat.length) continue;
        console.log(`\n${c.bold(cat)}`);
        for (const { item, status, prereqs } of inCat) {
          const missingPrereqs = prereqs.filter((p) => !p.ok);
          const mark = !status.installed ? c.red("✗") : missingPrereqs.length ? c.yellow("!") : c.green("✓");
          let detail = status.installed ? status.version ?? c.dim("installed") : c.dim("not installed");
          if (missingPrereqs.length) detail += c.yellow(status.installed ? "  but missing what it needs to run:" : "  needs:");
          console.log(`  ${mark} ${item.name.padEnd(20)} ${c.dim(item.id.padEnd(12))} ${detail}`);
          for (const p of missingPrereqs) console.log(`      ${prereqLine(p)}`);
        }
      }

      if (project) {
        console.log(`\n${c.bold(`Project: ${project.name ?? project.dir}`)}  ${c.dim(`${project.dir} · ${project.pm}`)}`);
        for (const item of CATALOG.filter((i) => i.kind === "project")) {
          const s = detectInProject(item, project);
          const mark = s.installed ? c.green("✓") : c.dim("·");
          const detail = s.installed ? s.version ?? "" : c.dim("not in this project");
          console.log(`  ${mark} ${item.name.padEnd(20)} ${c.dim(item.id.padEnd(12))} ${detail}`);
        }
      }

      const todo = statuses.filter((s) => !s.status.installed || s.prereqs.some((p) => !p.ok)).map((s) => s.item.id);
      const manual = statuses.some((s) => s.prereqs.some((p) => !p.ok && !p.fixable));
      console.log();
      if (!todo.length) console.log(c.green("Everything is installed and set up."));
      else {
        console.log(`Fix with: ${c.cyan(`dkit install ${todo.join(" ")}`)}  ${c.dim("or just `dkit install` to pick")}`);
        console.log(c.dim("  ○ = dkit sets this up for you during install"));
        if (manual) console.log(c.dim("  ✗ = you need to do this yourself first"));
      }
    });

  program
    .command("catalog")
    .description("Show every tool, how it's installed on this OS, and how far dkit supports it")
    .option("--check", "Windows: confirm every winget package id exists")
    .action((opts: { check?: boolean }) => {
      const ctx = makeContext({});
      const os = ctx.platform.os;
      console.log(c.dim(`${"Tool".padEnd(20)} ${"id".padEnd(12)} ${"Support".padEnd(8)} How it's installed on ${os}`));
      for (const item of CATALOG) {
        const m = item.install[os];
        let mark = "";
        if (opts.check && m?.type === "winget") {
          const r = ctx.runner.run("winget", ["show", "--id", m.id, "--exact", "--accept-source-agreements", "--disable-interactivity"]);
          mark = r.ok ? c.green(" ✓ found") : c.red(" ✗ not found in winget");
        }
        const { level, has } = maturityOf(item, os);
        const support = `L${level}${has.snapshot && level < 4 ? "+S" : ""}`;
        const how = item.kind === "project" ? `project library: ${describePackages(item)}` : m ? describeMethod(m) : "not supported on this OS";
        console.log(`${item.name.padEnd(20)} ${c.dim(item.id.padEnd(12))} ${support.padEnd(8)} ${c.dim(how)}${mark}`);
      }
      console.log(c.dim(`\nSupport: ${LEVELS.map((l) => `L${l.level} ${l.label}`).join(" · ")}  (+S = settings move with \`dkit migrate\`)`));
      console.log(c.dim("Details for one tool: dkit info <id>"));
    });
}
