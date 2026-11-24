import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { compareManifest, differenceCount } from "../manifest/manifest.js";
import { MIN_PASSWORD, WrongPasswordError } from "../migrate/archive.js";
import type { Backup } from "../migrate/bundle.js";
import { compareFiles, manifestOf } from "../migrate/compare.js";
import { SECTIONS } from "../migrate/restore.js";
import { findCloudFolders } from "../sync/cloud.js";
import {
  checkSyncFolder, checkSyncPassword, createSyncFolder, isSyncFolder, listMachines, loadSyncConfig, machineFile, machineName,
  openMachine, pushMachine, removeSyncConfig, saveSyncConfig, syncConfigFile, syncFolderFor, validMachineName, type SyncConfig,
} from "../sync/sync.js";
import { c, silentLogger } from "../utils/logger.js";
import { askNewPassword, chooseOne, makePassword, PASSWORD_ENV } from "../utils/prompt.js";
import { STORE_LABEL, forgetPassword, loadPassword, savePassword } from "../utils/secret-store.js";
import { makeContext, resolveProject, type CommonOpts } from "./context.js";
import { printBackupComparison, runRestore } from "./migrate.js";

type Ctx = ReturnType<typeof makeContext>;

function requireConfig(ctx: Ctx): SyncConfig {
  const cfg = loadSyncConfig(ctx.platform);
  if (!cfg) throw new Error("Sync isn't set up on this PC. Start with: dkit sync init");
  if (!existsSync(cfg.folder)) throw new Error(`The sync folder ${cfg.folder} isn't there. Is your cloud app (OneDrive, Dropbox...) running and signed in?`);
  checkSyncFolder(cfg.folder);
  return cfg;
}

/** The sync password: DKIT_BACKUP_PASSWORD, or the one saved by `dkit sync init`. */
function syncPassword(ctx: Ctx, cfg: SyncConfig): string {
  const pw = process.env[PASSWORD_ENV] || (cfg.store ? loadPassword(cfg.store, ctx.runner, ctx.platform, "sync") : null);
  if (!pw) throw new Error(`Couldn't read the sync password${cfg.store ? ` from ${STORE_LABEL[cfg.store]} (is it locked?)` : ""}. Run \`dkit sync init\` again to save it.`);
  return pw;
}

/** Every PC's file in the folder, opened. Files the password can't open are reported, not fatal. */
async function openAll(cfg: SyncConfig, password: string) {
  const { machines, ignored } = listMachines(cfg.folder);
  const opened: { name: string; file: string; backup: Backup }[] = [];
  const unreadable: string[] = [];
  for (const m of machines) {
    try { opened.push({ ...m, backup: await openMachine(m.file, password) }); } catch (e) {
      unreadable.push(`${m.name}: ${e instanceof WrongPasswordError ? "made with a different password" : e instanceof Error ? e.message : String(e)}`);
    }
  }
  opened.sort((a, b) => b.backup.createdAt.localeCompare(a.backup.createdAt));
  return { opened, unreadable, ignored };
}

const when = (iso: string) => new Date(iso).toLocaleString();

export function registerSync(program: Command) {
  const sync = program
    .command("sync")
    .description("Keep your PCs' setups in step through a cloud folder (OneDrive, Dropbox, Google Drive, iCloud). Encrypted");

  sync
    .command("init")
    .description("Set up sync on this PC: pick the cloud folder and the password every PC shares")
    .option("--folder <dir>", "the cloud folder to use (default: found for you)")
    .option("--name <machine>", "this PC's name in the folder (default: its computer name)")
    .action(async (opts: { folder?: string; name?: string }) => {
      const ctx = makeContext({});
      const existing = loadSyncConfig(ctx.platform);
      if (existing) throw new Error(`Sync is already set up: ${existing.folder} as "${existing.machine}". To change it, run \`dkit sync leave\` first.`);

      let base: string;
      if (opts.folder) {
        base = path.resolve(opts.folder);
        if (!existsSync(base)) throw new Error(`${base} doesn't exist. Point --folder at a folder your cloud app syncs.`);
      } else {
        const found = findCloudFolders(ctx.platform);
        if (!found.length) {
          throw new Error(
            "No cloud folder found (OneDrive, Dropbox, Google Drive, iCloud Drive).\n" +
            "Install and sign in to one, or name a folder: dkit sync init --folder <path>" +
            (ctx.platform.wsl ? "\nIn WSL, use your Windows cloud folder, e.g. --folder /mnt/c/Users/<you>/OneDrive" : ""),
          );
        }
        base = await chooseOne("Which cloud folder?", found.map((f) => ({ value: f.path, name: `${f.provider.padEnd(13)} ${f.path}` })));
        ctx.log.info(`Using ${c.bold(base)}${found.length > 1 ? c.dim("  (pick another with --folder)") : ""}`);
      }
      const folder = syncFolderFor(base);
      const machine = opts.name ? opts.name.toLowerCase() : machineName(ctx.platform.hostname);
      if (!validMachineName(machine)) throw new Error(`"${machine}" can't be a PC name: use lowercase letters, digits and dashes (--name my-laptop).`);

      let password: string;
      if (isSyncFolder(folder)) {
        checkSyncFolder(folder);
        const { machines } = listMachines(folder);
        ctx.log.info(`Joining the sync folder ${folder}${machines.length ? c.dim(` (PCs: ${machines.map((m) => m.name).join(", ")})`) : ""}`);
        if (machines.some((m) => m.name === machine)) {
          const ok = await ctx.confirm(`A PC called "${machine}" already saved its setup here. Is that this PC? (If not, answer no and use --name.)`);
          if (!ok) return ctx.log.warn("Stopped. Run again with --name <another-name>.");
        }
        const ask = makePassword();
        for (let attempt = 1; ; attempt++) {
          password = await ask("Sync password (the one you chose on your first PC)");
          const check = await checkSyncPassword(folder, password);
          if (check !== false) break;
          if (process.env[PASSWORD_ENV] || attempt >= 3) throw new Error("That password doesn't open the files in this sync folder.");
          console.error("That password doesn't open the files in this folder. Try again.");
        }
      } else {
        ctx.log.info(`Creating ${c.bold(folder)}`);
        ctx.log.info(c.dim("Choose a password. Every PC you sync uses this same password, and it can't be recovered."));
        password = await askNewPassword(makePassword(), MIN_PASSWORD);
        createSyncFolder(folder);
      }

      const store = savePassword(password, ctx.runner, ctx.platform, "sync");
      if (loadPassword(store, ctx.runner, ctx.platform, "sync") !== password) throw new Error("The password was saved but couldn't be read back, so sync wasn't set up.");
      const cfg: SyncConfig = { folder, machine, store };
      saveSyncConfig(ctx.platform, cfg);

      ctx.log.step("Saving this PC's setup to the sync folder…");
      const r = pushMachine(ctx, cfg, password);
      cfg.lastPush = new Date().toISOString();
      saveSyncConfig(ctx.platform, cfg);

      ctx.log.ok(`Sync is set up. This PC is "${machine}".`);
      ctx.log.info(`  Folder       ${folder}`);
      ctx.log.info(`  Password in  ${STORE_LABEL[store]}`);
      ctx.log.info(`  Saved        ${r.file}`);
      ctx.log.info(c.bold("\nOn your other PCs"));
      ctx.log.info(`  ${c.cyan("dkit sync init")}   ${c.dim("(same cloud account, same password)")}`);
      ctx.log.info(`  ${c.cyan("dkit sync pull")}   ${c.dim("get what this PC has")}`);
      ctx.log.info(c.dim("\nAfter you change your setup here, run `dkit sync push`. See every PC: dkit sync status"));
    });

  sync
    .command("push")
    .description("Save this PC's setup to the sync folder, so your other PCs can pull it")
    .option("--quiet", "no output (for scripts and schedules); exits with 1 on failure")
    .action((opts: { quiet?: boolean }) => {
      const ctx = makeContext({});
      const log = opts.quiet ? silentLogger : ctx.log;
      try {
        const cfg = requireConfig(ctx);
        const r = pushMachine({ ...ctx, log }, cfg, syncPassword(ctx, cfg));
        cfg.lastPush = new Date().toISOString();
        saveSyncConfig(ctx.platform, cfg);
        log.ok(`Saved this PC's setup: ${r.file}`);
        log.info(c.dim("Your cloud app uploads it. On another PC: dkit sync pull"));
      } catch (e) {
        if (!opts.quiet) throw e;
        process.exitCode = 1;
      }
    });

  sync
    .command("status")
    .description("Every PC in the sync folder, and how each differs from this one (changes nothing)")
    .action(async () => {
      const ctx = { ...makeContext({}), ...resolveProject({}) };
      const cfg = requireConfig(ctx);
      ctx.log.step("Reading the sync folder…");
      const { opened, unreadable, ignored } = await openAll(cfg, syncPassword(ctx, cfg));
      ctx.log.info(c.bold(`\nSync folder  `) + cfg.folder);
      ctx.log.info(c.bold("This PC      ") + `${cfg.machine}  ${c.dim(cfg.lastPush ? `last pushed ${when(cfg.lastPush)}` : "not pushed yet")}`);
      if (cfg.lastPull) ctx.log.info(c.bold("Last pull    ") + `from ${cfg.lastPull.from}, ${when(cfg.lastPull.at)}`);

      ctx.log.info("");
      for (const { name, backup } of opened) {
        const head = `${name.padEnd(20)} ${backup.source.os.padEnd(8)} ${when(backup.createdAt).padEnd(24)}`;
        if (name === cfg.machine) { ctx.log.info(`  ${c.green("●")} ${head} ${c.dim("this PC")}`); continue; }
        const diff = differenceCount(compareManifest(manifestOf(backup), ctx)) + compareFiles(backup, ctx.platform).filter((f) => f.state !== "same").length;
        ctx.log.info(`  ${diff ? c.yellow("≠") : c.green("✓")} ${head} ${diff ? `${diff} difference(s): ${c.cyan(`dkit sync pull --from ${name}`)}` : c.dim("same as this PC")}`);
      }
      if (!opened.some((o) => o.name !== cfg.machine)) ctx.log.info(c.dim("  No other PC has synced yet. On another PC: dkit sync init"));
      for (const u of unreadable) ctx.log.warn(`Can't read ${u}`);
      if (ignored.length) ctx.log.info(c.dim(`\nIgnored (not a PC's file, e.g. a cloud app's conflict copy): ${ignored.join(", ")}`));
    });

  sync
    .command("pull")
    .description("Bring this PC in line with another PC's setup: compare, pick, confirm. Tools are only ever added")
    .option("--from <machine>", "which PC to pull from (default: the one that pushed most recently)")
    .option("--only <sections>", `comma-separated: ${SECTIONS.join(",")}`)
    .option("--dry-run", "show what would change, change nothing")
    .option("-y, --yes", "accept the defaults without asking")
    .action(async (opts: CommonOpts & { from?: string; only?: string }) => {
      const ctx = { ...makeContext(opts), ...resolveProject({}) };
      const cfg = requireConfig(ctx);
      const { opened, unreadable } = await openAll(cfg, syncPassword(ctx, cfg));
      for (const u of unreadable) ctx.log.warn(`Can't read ${u}`);
      const others = opened.filter((o) => o.name !== cfg.machine);
      if (!others.length) return ctx.log.info("No other PC has saved its setup here yet. On another PC: dkit sync init");
      const source = opts.from ? others.find((o) => o.name === opts.from!.toLowerCase()) : others[0];
      if (!source) throw new Error(`No PC called "${opts.from}" in the sync folder. PCs: ${others.map((o) => o.name).join(", ")}`);

      ctx.log.info(c.bold(`dkit sync pull  ${c.dim(`this PC vs ${source.name} (${source.backup.source.os}), pushed ${when(source.backup.createdAt)}`)}`));
      printBackupComparison(source.backup, ctx, false); // runRestore says it when it starts
      ctx.log.info("");
      const done = await runRestore(source.backup, ctx, opts.only);
      if (done) {
        cfg.lastPull = { at: new Date().toISOString(), from: source.name };
        saveSyncConfig(ctx.platform, cfg);
        ctx.log.info(c.dim("\nTo share this PC's setup back: dkit sync push"));
      }
    });

  sync
    .command("leave")
    .description("Stop syncing on this PC: forgets the folder and the saved password")
    .option("--delete-my-file", "also delete this PC's file from the sync folder")
    .action((opts: { deleteMyFile?: boolean }) => {
      const ctx = makeContext({});
      const cfg = loadSyncConfig(ctx.platform);
      if (!cfg) return ctx.log.info("Sync isn't set up on this PC.");
      if (cfg.store) forgetPassword(cfg.store, ctx.runner, ctx.platform, "sync");
      if (opts.deleteMyFile) rmSync(machineFile(cfg), { force: true });
      removeSyncConfig(ctx.platform);
      ctx.log.ok("This PC no longer syncs. The saved sync password was deleted.");
      ctx.log.info(c.dim(opts.deleteMyFile ? `Deleted ${machineFile(cfg)}.` : `This PC's last file stays in ${cfg.folder} (remove it with --delete-my-file). Settings were in ${syncConfigFile(ctx.platform)}.`));
    });
}
