import path from "node:path";
import type { Command } from "commander";
import { MIN_PASSWORD } from "../migrate/archive.js";
import {
  DAYS, currentDkit, describeWhen, isScheduled, parseTime, schedule, unschedule, type Day, type Every,
} from "../snapshot/schedule.js";
import {
  DEFAULT_KEEP, configFile, listSnapshots, loadConfig, logFile, logRun, saveConfig, takeSnapshot,
} from "../snapshot/snapshot.js";
import { c, silentLogger } from "../utils/logger.js";
import { askNewPassword, makePassword, PASSWORD_ENV } from "../utils/prompt.js";
import { STORE_LABEL, forgetPassword, loadPassword, savePassword } from "../utils/secret-store.js";
import { makeContext } from "./context.js";

const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`;

export function registerSnapshot(program: Command) {
  const snap = program
    .command("snapshot")
    .description("Back up your setup automatically on a schedule, keeping the last few (encrypted .dkit files)");

  snap
    .command("schedule")
    .description("Turn on automatic snapshots (asks for the password once and keeps it in your OS's secure storage)")
    .option("--every <when>", "daily or weekly", "daily")
    .option("--day <day>", `weekly: ${DAYS.join(", ")}`, "sun")
    .option("--time <HH:MM>", "time of day, 24-hour", "12:00")
    .option("--keep <n>", "how many snapshots to keep", String(DEFAULT_KEEP))
    .option("--folder <dir>", "where to keep them (default: ~/.dkit/snapshots)")
    .action(async (opts: { every: string; day: string; time: string; keep: string; folder?: string }) => {
      const ctx = makeContext({});
      const every = opts.every.toLowerCase() as Every;
      if (!["daily", "weekly"].includes(every)) throw new Error(`--every must be daily or weekly.`);
      const day = opts.day.toLowerCase().slice(0, 3) as Day;
      if (!DAYS.includes(day)) throw new Error(`--day must be one of ${DAYS.join(", ")}.`);
      parseTime(opts.time);
      const keep = Number(opts.keep);
      if (!Number.isInteger(keep) || keep < 1 || keep > 100) throw new Error("--keep must be a number from 1 to 100.");

      const cfg = loadConfig(ctx.platform);
      cfg.keep = keep;
      if (opts.folder) cfg.folder = path.resolve(opts.folder);
      cfg.when = { every, time: opts.time, ...(every === "weekly" ? { day } : {}) };

      ctx.log.info(c.dim("Snapshots are encrypted. You'll need this password to restore one; it can't be recovered."));
      ctx.log.info(c.dim("dkit keeps it in your OS's secure storage so snapshots can run on their own."));
      const password = await askNewPassword(makePassword(), MIN_PASSWORD);
      if (cfg.store) forgetPassword(cfg.store, ctx.runner, ctx.platform); // e.g. moved from file to keyring
      cfg.store = savePassword(password, ctx.runner, ctx.platform);
      if (loadPassword(cfg.store, ctx.runner, ctx.platform) !== password) throw new Error("The password was saved but couldn't be read back, so scheduling was stopped. Nothing was scheduled.");

      const result = schedule(cfg.when, currentDkit(), ctx.runner, ctx.platform);
      saveConfig(ctx.platform, cfg);

      ctx.log.ok(`Snapshots scheduled ${describeWhen(cfg.when)}, keeping the last ${keep}`);
      ctx.log.info(`  Scheduled in   ${result.where}`);
      ctx.log.info(`  Password in    ${STORE_LABEL[cfg.store]}`);
      ctx.log.info(`  Saved to       ${cfg.folder}`);
      for (const n of result.notes) ctx.log.info(c.dim(`  • ${n}`));
      if (cfg.store === "file") ctx.log.warn("No keyring was found, so the password is in a file only your user can read. Anyone who can sign in as you can read it.");
      ctx.log.info(c.dim(`\nTry it now: dkit snapshot run    See them: dkit snapshot list    Stop: dkit snapshot unschedule`));
      ctx.log.info(c.dim("If dkit moves (a new Node.js version, or reinstalling dkit), run this command again so the schedule points at the new location."));
    });

  snap
    .command("run")
    .description("Take a snapshot now")
    .option("--quiet", "no output; write the result to ~/.dkit/snapshots.log (used by the schedule)")
    .action(async (opts: { quiet?: boolean }) => {
      const ctx = makeContext({});
      const cfg = loadConfig(ctx.platform);
      const log = opts.quiet ? silentLogger : ctx.log;
      try {
        let password = process.env[PASSWORD_ENV] || (cfg.store ? loadPassword(cfg.store, ctx.runner, ctx.platform) : null);
        if (!password) {
          if (cfg.store) throw new Error(`Couldn't read the snapshot password from ${STORE_LABEL[cfg.store]} (is it locked?). Run \`dkit snapshot schedule\` again to save it.`);
          if (opts.quiet) throw new Error("No snapshot password is saved. Run `dkit snapshot schedule` first.");
          ctx.log.info(c.dim("Snapshots are encrypted. (To save the password and run them automatically: dkit snapshot schedule)"));
          password = await askNewPassword(makePassword(), MIN_PASSWORD);
        }
        const r = takeSnapshot({ ...ctx, log }, cfg, password);
        cfg.lastRun = { at: new Date().toISOString(), ok: true, file: r.file };
        saveConfig(ctx.platform, cfg);
        logRun(ctx.platform, `ok      ${r.file}${r.removed.length ? `  (removed ${r.removed.length} old)` : ""}`);
        log.ok(`Snapshot saved: ${r.file}`);
        if (r.removed.length) log.info(c.dim(`  Removed ${r.removed.length} older snapshot(s), keeping the last ${cfg.keep}.`));
        log.info(c.dim(`  Restore it on any PC: dkit migrate restore "${r.file}" --dry-run`));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        cfg.lastRun = { at: new Date().toISOString(), ok: false, error: msg };
        saveConfig(ctx.platform, cfg);
        logRun(ctx.platform, `FAILED  ${msg}`);
        if (opts.quiet) { process.exitCode = 1; return; }
        throw e;
      }
    });

  snap
    .command("list")
    .alias("ls")
    .description("Show your snapshots, the schedule, and how the last run went")
    .action(() => {
      const ctx = makeContext({});
      const cfg = loadConfig(ctx.platform);
      const scheduled = cfg.when && isScheduled(ctx.runner, ctx.platform);
      ctx.log.info(c.bold("Schedule     ") + (scheduled ? describeWhen(cfg.when!) + c.dim(`, keeping the last ${cfg.keep}`) : c.dim("off (turn it on: dkit snapshot schedule)")));
      if (cfg.when && !scheduled) ctx.log.warn("The settings say it's scheduled, but the OS has no job for it. Run `dkit snapshot schedule` again.");
      if (cfg.lastRun) {
        const at = new Date(cfg.lastRun.at).toLocaleString();
        ctx.log.info(c.bold("Last run     ") + (cfg.lastRun.ok ? `${c.green("ok")}  ${at}` : `${c.red("failed")}  ${at}: ${cfg.lastRun.error}`));
      }
      ctx.log.info(c.bold("Folder       ") + cfg.folder);
      const snaps = listSnapshots(cfg.folder);
      if (!snaps.length) { ctx.log.info(c.dim("\nNo snapshots yet. Take one now: dkit snapshot run")); return; }
      ctx.log.info("");
      for (const s of snaps) ctx.log.info(`  ${s.taken.toLocaleString().padEnd(24)} ${kb(s.size).padStart(7)}  ${s.name}`);
      ctx.log.info(c.dim(`\nRestore one: dkit migrate restore "${snaps[0].file}" --dry-run`));
      ctx.log.info(c.dim(`Log: ${logFile(ctx.platform)}`));
    });

  snap
    .command("unschedule")
    .description("Turn automatic snapshots off (your snapshots are kept)")
    .option("--forget-password", "also delete the saved password")
    .action((opts: { forgetPassword?: boolean }) => {
      const ctx = makeContext({});
      const cfg = loadConfig(ctx.platform);
      const removed = unschedule(ctx.runner, ctx.platform);
      ctx.log.ok(removed ? "Automatic snapshots are off." : "There was no scheduled job (already off).");
      delete cfg.when;
      if (opts.forgetPassword && cfg.store) {
        forgetPassword(cfg.store, ctx.runner, ctx.platform);
        ctx.log.ok(`Deleted the saved password from ${STORE_LABEL[cfg.store]}.`);
        delete cfg.store;
      } else if (cfg.store) ctx.log.info(c.dim("The password is still saved (for `dkit snapshot run`). Remove it with --forget-password."));
      saveConfig(ctx.platform, cfg);
      ctx.log.info(c.dim(`Your snapshots are still in ${cfg.folder}. Settings: ${configFile(ctx.platform)}`));
    });
}
