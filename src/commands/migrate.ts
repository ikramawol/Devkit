import type { Command } from "commander";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createBackup } from "../migrate/export.js";
import {
  SECTIONS, SECTION_LABELS, availableSections, restoreBackup, validateBackup, type Section,
} from "../migrate/restore.js";
import { c } from "../utils/logger.js";
import { makeContext, type CommonOpts } from "./context.js";

export function registerMigrate(program: Command) {
  const migrate = program.command("migrate").description("Move your developer setup to another PC or OS");

  migrate
    .command("export")
    .description("Save this machine's setup into one backup file")
    .option("-o, --out <file>", "where to write the backup")
    .action((opts: { out?: string }) => {
      const ctx = makeContext({});
      const backup = createBackup(ctx);
      const date = new Date().toISOString().slice(0, 10);
      const out = path.resolve(opts.out ?? `dkit-backup-${ctx.platform.hostname}-${date}.json`);
      writeFileSync(out, JSON.stringify(backup, null, 1));

      ctx.log.info(c.bold("\nBackup saved: ") + out);
      ctx.log.info(c.dim("Copy it to the new machine (USB, cloud drive) and run:"));
      ctx.log.info(c.cyan(`  dkit migrate restore "${path.basename(out)}" --dry-run`));
      ctx.log.warn("It contains your settings (secret values are removed). Keep it private anyway.");
      if (backup.notes.length) {
        ctx.log.info(c.bold("\nNotes"));
        for (const n of backup.notes) ctx.log.info(`  • ${n}`);
      }
    });

  migrate
    .command("restore <file>")
    .description("Rebuild a setup from a backup file on this machine")
    .option("--only <sections>", `comma-separated: ${SECTIONS.join(",")}`)
    .option("--dry-run", "show everything that would change, change nothing")
    .option("-y, --yes", "accept the defaults without asking")
    .action(async (file: string, opts: CommonOpts & { only?: string }) => {
      const ctx = makeContext(opts);
      const backup = validateBackup(JSON.parse(readFileSync(file, "utf8")));
      ctx.log.info(c.bold(`Backup from ${backup.source.hostname} (${backup.source.os}), ${backup.createdAt.slice(0, 10)}`));
      if (backup.source.os !== ctx.platform.os)
        ctx.log.info(c.yellow(`Moving from ${backup.source.os} to ${ctx.platform.os}: tools are installed with this OS's installers.`));

      const available = availableSections(backup, ctx.platform);
      let sections: Section[];
      if (opts.only) {
        sections = opts.only.split(",").map((s) => s.trim()) as Section[];
        const bad = sections.filter((s) => !SECTIONS.includes(s));
        if (bad.length) throw new Error(`Unknown section(s): ${bad.join(", ")}`);
      } else {
        sections = (await ctx.select(
          "What should be restored?",
          available.map((s) => ({ value: s, name: SECTION_LABELS[s], checked: s !== "apps" })),
        )) as Section[];
      }
      if (!sections.length) return ctx.log.info("Nothing selected.");

      if (!ctx.dryRun && sections.some((s) => s !== "tools" && s !== "apps")) {
        const ok = await ctx.confirm("Settings files will be written. Existing files are backed up first. Continue?");
        if (!ok) return ctx.log.warn("Cancelled. Nothing was changed.");
      }

      const report = await restoreBackup(backup, { ...ctx, sections });

      ctx.log.info(c.bold(ctx.dryRun ? "\nDry run finished. Nothing was changed." : "\nRestore finished."));
      if (report.backedUp.length)
        ctx.log.info(ctx.dryRun
          ? `${report.backedUp.length} existing file(s) would be replaced (a *.dkit-backup-<time> copy is kept first).`
          : `${report.backedUp.length} existing file(s) were saved as *.dkit-backup-<time> before being replaced.`);
      if (report.notes.length) {
        ctx.log.info(c.bold("\nTo do by hand"));
        for (const n of [...new Set(report.notes)]) ctx.log.info(`  • ${n}`);
      }
    });
}
