import type { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createBackup } from "../migrate/export.js";
import {
  SECTIONS, SECTION_LABELS, availableSections, restoreBackup, type Section,
} from "../migrate/restore.js";
import { BACKUP_EXT, MIN_PASSWORD, backupFileInfo, readBackupFile, writeBackupFile } from "../migrate/archive.js";
import { compareFiles, compareMcp, manifestOf, printFileComparison, printInspect } from "../migrate/compare.js";
import { compareManifest } from "../manifest/manifest.js";
import { printComparison } from "../manifest/status.js";
import { askNewPassword, makePassword, PASSWORD_ENV } from "../utils/prompt.js";
import { c } from "../utils/logger.js";
import { makeContext, resolveProject, type CommonOpts } from "./context.js";

/** Open a backup file, asking for its password if it's encrypted (3 tries). */
async function openBackup(file: string) {
  if (!existsSync(file)) throw new Error(`${file}: no such file.`);
  const ask = makePassword();
  // Retrying only helps when you're typing it; a wrong DKIT_BACKUP_PASSWORD would just fail again.
  const backup = await readBackupFile(file, () => ask("Backup password"), !process.env[PASSWORD_ENV]);
  return { backup, info: backupFileInfo(readFileSync(file)) };
}

export function registerMigrate(program: Command) {
  const migrate = program.command("migrate").description("Move your developer setup to another PC or OS");

  migrate
    .command("export")
    .description("Save this machine's setup into one encrypted backup file")
    .option("-o, --out <file>", `where to write the backup (a folder, like a USB drive, works too)`)
    .option("--no-encrypt", "don't ask for a password (anyone with the file can read your settings)")
    .option("-f, --force", "overwrite the file if it exists")
    .action(async (opts: { out?: string; encrypt: boolean; force?: boolean }) => {
      const ctx = makeContext({});
      const date = new Date().toISOString().slice(0, 10);
      const name = `dkit-backup-${ctx.platform.hostname}-${date}${BACKUP_EXT}`;
      let out = path.resolve(opts.out ?? name);
      if (opts.out && existsSync(out) && !path.extname(out)) out = path.join(out, name); // --out E:\ (a folder)
      if (existsSync(out) && !opts.force) throw new Error(`${out} already exists. Use --force to overwrite it, or --out to pick another name.`);

      // Ask before the slow scan, so a typo in the password doesn't waste a minute.
      let password: string | null = null;
      if (opts.encrypt) {
        ctx.log.info(c.dim(`The backup is encrypted. You'll need this password to restore it; it can't be recovered. (Scripts: set ${PASSWORD_ENV}; or use --no-encrypt.)`));
        password = await askNewPassword(makePassword(), MIN_PASSWORD);
      }

      const backup = createBackup(ctx);
      writeBackupFile(out, backup, password);

      ctx.log.info(c.bold("\nBackup saved: ") + out + c.dim(`  (${password ? "encrypted" : "NOT encrypted"})`));
      ctx.log.info(c.dim("Copy it to the new machine (USB, cloud drive) and run:"));
      ctx.log.info(c.cyan(`  dkit migrate inspect "${path.basename(out)}"`) + c.dim("   what's inside"));
      ctx.log.info(c.cyan(`  dkit migrate compare "${path.basename(out)}"`) + c.dim("   what's different on that PC"));
      ctx.log.info(c.cyan(`  dkit migrate restore "${path.basename(out)}" --dry-run`));
      if (!password) ctx.log.warn("Not encrypted: it holds your settings (secret values are removed). Keep it private.");
      if (backup.notes.length) {
        ctx.log.info(c.bold("\nNotes"));
        for (const n of backup.notes) ctx.log.info(`  • ${n}`);
      }
    });

  migrate
    .command("inspect <file>")
    .description("Show what's in a backup and check it isn't damaged (changes nothing)")
    .action(async (file: string) => {
      const ctx = makeContext({});
      const { backup, info } = await openBackup(file);
      printInspect(file, info, backup, ctx.log);
      ctx.log.info(c.dim(`\nCompare with this PC: dkit migrate compare "${file}"`));
    });

  migrate
    .command("compare <file>")
    .description("Compare a backup with this machine: tools, extensions, settings files (changes nothing)")
    .option("-p, --project <folder>", "project to compare libraries in")
    .action(async (file: string, opts: { project?: string }) => {
      const ctx = { ...makeContext({}), ...resolveProject({ project: opts.project }) };
      const { backup } = await openBackup(file);
      ctx.log.info(c.bold(`dkit migrate compare  ${c.dim(`this PC vs the backup from ${backup.source.hostname}`)}`));
      if (backup.source.os !== ctx.platform.os)
        ctx.log.info(c.yellow(`From ${backup.source.os} to ${ctx.platform.os}: tools would be installed with this OS's installers.`));
      printComparison(compareManifest(manifestOf(backup), ctx), ctx.log, ctx.platform.os);
      printFileComparison(compareFiles(backup, ctx.platform), compareMcp(backup, ctx.platform), ctx.log);
      ctx.log.info(c.dim(`\nApply it: dkit migrate restore "${file}" --dry-run, then without --dry-run`));
    });

  migrate
    .command("restore <file>")
    .description("Rebuild a setup from a backup file on this machine")
    .option("--only <sections>", `comma-separated: ${SECTIONS.join(",")}`)
    .option("--dry-run", "show everything that would change, change nothing")
    .option("-y, --yes", "accept the defaults without asking")
    .action(async (file: string, opts: CommonOpts & { only?: string }) => {
      const ctx = makeContext(opts);
      const { backup } = await openBackup(file);
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
