import type { Command } from "commander";
import { CATALOG, getItem, requiresFor, type CatalogItem } from "../core/catalog.js";
import { detectItem } from "../core/detect.js";
import { prereqLine } from "../core/engine.js";
import { LEVELS, levelLabel, maturityOf } from "../core/maturity.js";
import type { OS } from "../core/platform.js";
import { checkPrereqs } from "../core/prereqs.js";
import { describeMethod } from "../adapters/methods.js";
import { c } from "../utils/logger.js";
import { describePackages, detectInProject } from "../core/project.js";
import { makeContext, resolveProject } from "./context.js";

const KIND_TEXT = { machine: "installed on this computer", project: "added to a project" } as const;
const OSES: OS[] = ["windows", "macos", "linux"];

/** Ids that look like what the user typed, for "did you mean". */
function suggest(input: string): CatalogItem[] {
  const q = input.toLowerCase();
  return CATALOG.filter((i) => i.id.includes(q) || q.includes(i.id) || i.name.toLowerCase().includes(q));
}

export function registerInfo(program: Command) {
  program
    .command("info <tool>")
    .description("Everything dkit knows about one tool: status, support level, what it needs")
    .option("--json", "output JSON")
    .addHelpText("after", "\nExamples:\n  dkit info docker\n  dkit info claude --json")
    .action((id: string, opts: { json?: boolean }) => {
      const ctx = makeContext({});
      const os = ctx.platform.os;
      const item = getItem(id.toLowerCase());
      if (!item) {
        const near = suggest(id);
        ctx.log.error(`Unknown tool "${id}".${near.length ? ` Did you mean: ${near.map((i) => i.id).join(", ")}?` : ""}`);
        ctx.log.info(c.dim("See every tool with `dkit catalog`."));
        process.exitCode = 1;
        return;
      }

      const isProject = item.kind === "project";
      const { project } = isProject ? resolveProject({}) : { project: undefined };
      const status = isProject ? (project ? detectInProject(item, project) : undefined) : detectItem(item, ctx);
      const maturity = maturityOf(item, os);
      const prereqs = checkPrereqs(item, os, ctx.runner);
      const requires = requiresFor(item, os);

      if (opts.json) {
        console.log(JSON.stringify({
          id: item.id, name: item.name, kind: item.kind, category: item.category, description: item.description,
          status, maturity: { os, ...maturity },
          prereqs: prereqs.map(({ key, label, ok, fixable }) => ({ key, label, ok, fixable })),
          requires, snapshot: item.snapshot ?? [], install: item.install, notes: item.notes ?? [],
        }, null, 2));
        return;
      }

      const line = (label: string, value: string) => console.log(`${c.dim(label.padEnd(10))} ${value}`);
      console.log(`${c.bold(item.name)}  ${c.dim(`(${item.id})`)}`);
      console.log(item.description);
      console.log();
      line("Kind", `${item.kind} ${c.dim(`- ${KIND_TEXT[item.kind]}`)}`);
      line("Category", item.category);
      const projName = project?.name ?? "this project";
      if (!status) line("Status", c.dim("run this inside a project to see if it has it"));
      else if (isProject) line("Status", status.installed ? c.green(`✓ in ${projName} ${status.version ?? ""}`.trim()) : c.dim(`· not in ${projName}`));
      else line("Status", status.installed ? c.green(`✓ installed ${status.version ?? ""}`.trim()) : c.red("✗ not installed"));
      if (requires.length) line("Requires", requires.map((r) => getItem(r)?.name ?? r).join(", "));

      console.log(`\n${c.bold(`Support on ${os}:`)} ${levelLabel(maturity.level)}`);
      const method = item.install[os];
      for (const l of LEVELS) {
        let detail: string = l.means;
        if (l.key === "install" && method) detail = describeMethod(method);
        if (l.key === "install" && isProject) detail = `${describePackages(item)} with the project's package manager`;
        if (l.key === "snapshot" && item.snapshot) detail = item.snapshot.join(", ");
        if (l.key === "maintain") detail = "dkit update · dkit uninstall · checked by dkit diagnose";
        const mark = maturity.has[l.key] ? c.green("✓") : c.dim("·");
        console.log(`  ${mark} ${`${l.level} ${l.label}`.padEnd(21)} ${maturity.has[l.key] ? detail : c.dim("not supported yet")}`);
      }

      if (prereqs.length) {
        console.log(`\n${c.bold("Needs set up first")} ${c.dim("(checked on this PC)")}`);
        for (const p of prereqs) console.log(`  ${prereqLine(p)}`);
      }

      const others = isProject ? [] : OSES.filter((o) => o !== os);
      if (others.length) console.log(`\n${c.bold("On other systems")}`);
      else if (isProject) console.log(`\n${c.dim("Works the same on Windows, macOS and Linux.")}`);
      for (const o of others) {
        const m = item.install[o];
        console.log(`  ${o.padEnd(8)} ${m ? describeMethod(m) : c.dim("not supported")}  ${c.dim(levelLabel(maturityOf(item, o).level))}`);
      }

      if (item.notes?.length) {
        console.log(`\n${c.bold("Notes")}`);
        for (const n of item.notes) console.log(`  • ${n}`);
      }
      if (!status?.installed) {
        const hint = isProject && !project ? c.dim("  (inside your project, or add --project <folder>)") : "";
        console.log(`\nInstall with: ${c.cyan(`dkit install ${item.id}`)}${hint}`);
      }
    });
}
