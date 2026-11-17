import type { Command } from "commander";
import { CATALOG, CATEGORIES } from "../core/catalog.js";
import { detectItem } from "../core/detect.js";
import { installTools } from "../core/engine.js";
import { c } from "../utils/logger.js";
import type { Choice } from "../utils/prompt.js";
import { makeContext, type CommonOpts } from "./context.js";

export function registerInstall(program: Command) {
  program
    .command("install [tools...]")
    .description("Install developer tools. No names = pick from a checklist.")
    .option("--all", "install every tool in the catalog")
    .option("--dry-run", "show the plan without changing anything")
    .option("-y, --yes", "don't ask for confirmation")
    .addHelpText("after", `\nTool ids: ${CATALOG.map((i) => i.id).join(", ")}\nExamples:\n  dkit install\n  dkit install git node vscode claude\n  dkit install --all --dry-run`)
    .action(async (tools: string[], opts: CommonOpts & { all?: boolean }) => {
      const ctx = makeContext(opts);
      let ids = tools;

      if (opts.all) ids = CATALOG.map((i) => i.id);
      else if (!ids.length) {
        if (opts.yes) {
          ctx.log.error("Name the tools to install, or use --all, when using --yes.");
          process.exitCode = 1;
          return;
        }
        ctx.log.step("Checking what's already installed…");
        const choices: Choice[] = [];
        for (const cat of CATEGORIES) {
          for (const item of CATALOG.filter((i) => i.category === cat)) {
            const s = detectItem(item, ctx);
            const method = item.install[ctx.platform.os];
            choices.push({
              value: item.id,
              name: `${c.dim(cat.padEnd(13))} ${item.name}`,
              checked: false, // nothing is installed unless you pick it
              disabled: s.installed ? `installed ${s.version ?? ""}`.trim() : method?.type === "manual" ? "manual download" : false,
            });
          }
        }
        ids = await ctx.select("Pick the tools to install", choices);
        if (!ids.length) return ctx.log.info("Nothing selected.");
      }

      const report = await installTools(ids, ctx);
      if (report?.results.some((r) => r.outcome === "failed")) process.exitCode = 1;
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
