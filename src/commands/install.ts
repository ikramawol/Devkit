import type { Command } from "commander";
import { CATALOG, CATEGORIES } from "../core/catalog.js";
import { detectItem } from "../core/detect.js";
import { installTools } from "../core/engine.js";
import { checkPrereqs, type PrereqCheck } from "../core/prereqs.js";
import { detectInProject, itemEcosystem } from "../core/project.js";
import { c } from "../utils/logger.js";
import type { Choice } from "../utils/prompt.js";
import { makeContext, resolveProject, type CommonOpts, type ProjectOpts } from "./context.js";

const machineIds = () => CATALOG.filter((i) => i.kind === "machine").map((i) => i.id);
const projectIds = () => CATALOG.filter((i) => i.kind === "project").map((i) => i.id);

export function registerInstall(program: Command) {
  program
    .command("install [tools...]")
    .description("Install developer tools, or add libraries to a project. No names = pick from a checklist.")
    .option("--all", "install every machine tool in the catalog")
    .option("-p, --project <folder>", "project to add libraries to (default: the current folder)")
    .option("--pm <name>", "package manager for the project: npm, pnpm, yarn or bun (default: from its lockfile)")
    .option("--dry-run", "show the plan without changing anything")
    .option("-y, --yes", "don't ask for confirmation")
    .addHelpText(
      "after",
      `\nMachine tools: ${machineIds().join(", ")}` +
      `\nProject libraries: ${projectIds().join(", ")}` +
      `\n\nExamples:\n  dkit install\n  dkit install git node vscode claude\n  dkit install hono kysely dbmate          (inside your project)\n  dkit install drizzle --project ./my-api\n  dkit install --all --dry-run`,
    )
    .action(async (tools: string[], opts: CommonOpts & ProjectOpts & { all?: boolean }) => {
      const ctx = { ...makeContext(opts), ...resolveProject(opts) };
      let ids = tools.map((t) => t.toLowerCase());

      if (opts.all) ids = machineIds();
      else if (!ids.length) {
        if (opts.yes) {
          ctx.log.error("Name the tools to install, or use --all, when using --yes.");
          process.exitCode = 1;
          return;
        }
        ctx.log.step("Checking what's already installed…");
        const choices: Choice[] = [];
        const cache = new Map<string, PrereqCheck>();
        for (const cat of CATEGORIES) {
          for (const item of CATALOG.filter((i) => i.category === cat)) {
            if (item.kind === "project") {
              // Libraries only make sense inside a project, and only its own kind (no Go libraries in a JavaScript project).
              if (!ctx.project || itemEcosystem(item) !== ctx.project.ecosystem) continue;
              const s = detectInProject(item, ctx.project);
              choices.push({
                value: item.id,
                name: `${c.dim(cat.padEnd(18))} ${item.name}  ${c.dim(`→ ${ctx.project.name ?? "this project"}`)}`,
                checked: false,
                disabled: s.installed ? `in project ${s.version ?? ""}`.trim() : false,
              });
              continue;
            }
            const s = detectItem(item, ctx);
            const method = item.install[ctx.platform.os];
            // An installed tool that's missing what it needs to run can still be picked, to set that up.
            const needsSetup = s.installed && checkPrereqs(item, ctx.platform.os, ctx.runner, cache).some((p) => !p.ok);
            choices.push({
              value: item.id,
              name: `${c.dim(cat.padEnd(18))} ${item.name}${needsSetup ? c.yellow("  (installed, needs setup)") : ""}`,
              checked: false, // nothing is installed unless you pick it
              disabled: s.installed && !needsSetup ? `installed ${s.version ?? ""}`.trim() : method?.type === "manual" ? "manual download" : false,
            });
          }
        }
        if (!ctx.project) ctx.log.info(c.dim("  (Run this inside a project, or use --project, to also see libraries like Hono and Kysely.)"));
        ids = await ctx.select("Pick what to install", choices);
        if (!ids.length) return ctx.log.info("Nothing selected.");
      }

      const report = await installTools(ids, ctx);
      if (report?.results.some((r) => r.outcome === "failed" || r.outcome === "skipped")) process.exitCode = 1;
    });

  program
    .command("claude")
    .description("Shortcut for `dkit install claude` (adds Git on Windows if needed)")
    .option("--dry-run", "show the plan without changing anything")
    .option("-y, --yes", "don't ask for confirmation")
    .action(async (opts: CommonOpts) => {
      const report = await installTools(["claude"], makeContext(opts));
      if (report?.results.some((r) => r.outcome === "failed")) process.exitCode = 1;
    });
}
