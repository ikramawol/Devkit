import type { Command } from "commander";
import { existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { compareManifest, differenceCount, loadManifest, scanEnvironment } from "../manifest/manifest.js";
import { fixDifferences, printComparison, printScan } from "../manifest/status.js";
import { c } from "../utils/logger.js";
import { makeContext, resolveProject, type CommonOpts, type ProjectOpts } from "./context.js";

export const DEFAULT_MANIFEST = "dkit-manifest.json";

export function registerEnv(program: Command) {
  program
    .command("scan")
    .description("Describe this machine's setup (tools, versions, extensions, Git preferences) as a portable manifest")
    .option("-o, --out <file>", `save the manifest (e.g. ${DEFAULT_MANIFEST})`)
    .option("--json", "print the manifest as JSON")
    .option("-p, --project <folder>", "also record this project's libraries (default: the current folder, if it's a project)")
    .option("-f, --force", "overwrite --out if it exists")
    .action((opts: { out?: string; json?: boolean; project?: string; force?: boolean }) => {
      const ctx = makeContext({});
      const { project } = resolveProject({ project: opts.project });
      if (opts.out && existsSync(opts.out) && !opts.force) throw new Error(`${opts.out} already exists. Use --force to overwrite it.`);
      const manifest = scanEnvironment({ ...ctx, project });

      if (opts.json) {
        console.log(JSON.stringify(manifest, null, 2));
      } else {
        printScan(manifest, ctx.log);
      }
      if (opts.out) {
        const out = path.resolve(opts.out);
        writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
        if (!opts.json) {
          ctx.log.info(c.bold("\nManifest saved: ") + out);
          ctx.log.info(c.dim("It has no secrets or personal details, so you can commit it or share it."));
          ctx.log.info(c.dim("On another PC: ") + c.cyan(`dkit status ${path.basename(out)}`));
        }
      } else if (!opts.json) {
        ctx.log.info(c.dim(`\nSave it: dkit scan -o ${DEFAULT_MANIFEST}`));
      }
    });

  program
    .command("status [manifest]")
    .description(`Compare this machine with a manifest (or a migrate backup) and offer to install what's missing`)
    .option("-p, --project <folder>", "project to compare libraries in (default: the current folder)")
    .option("--pm <name>", "package manager for adding libraries (default: detected from the project)")
    .option("--check", "only report; exit with code 1 if anything differs (for scripts and CI)")
    .option("--dry-run", "show what would be installed, change nothing")
    .option("-y, --yes", "install without asking")
    .action(async (file: string | undefined, opts: CommonOpts & ProjectOpts & { check?: boolean }) => {
      const manifestFile = file ?? DEFAULT_MANIFEST;
      const manifest = loadManifest(manifestFile);
      const ctx = { ...makeContext(opts), ...resolveProject(opts) };
      ctx.log.info(c.bold(`dkit status  ${c.dim(`this PC vs ${manifestFile}`)}`));
      const cmp = compareManifest(manifest, ctx);
      printComparison(cmp, ctx.log, ctx.platform.os);

      if (opts.check) {
        if (differenceCount(cmp)) process.exitCode = 1;
        return;
      }
      if (differenceCount(cmp)) await fixDifferences(cmp, ctx);
    });
}
