import { getItem } from "../core/catalog.js";
import { installTools, type EngineContext } from "../core/engine.js";
import { EDITORS, installExtensions } from "../migrate/editors.js";
import { c, type Logger } from "../utils/logger.js";
import { compareSettings, differenceCount, type Comparison, type Manifest, type ResourceDiff } from "./manifest.js";

const SHELL_NAMES = { powershell: "PowerShell", bash: "bash", zsh: "zsh" };

/** "a, b, c +4 more" */
const short = (xs: string[], n = 5) => xs.slice(0, n).join(", ") + (xs.length > n ? c.dim(` +${xs.length - n} more`) : "");

const nameOf = (id: string) => getItem(id)?.name ?? id;

/** What `dkit scan` found, in a few lines. */
export function printScan(m: Manifest, log: Logger) {
  log.info(c.bold(`dkit scan  ${c.dim(`${m.source.os} ${m.source.arch}`)}`));

  log.info(c.bold(`\nTools (${m.tools.length})`));
  for (const t of m.tools) log.info(`  ${nameOf(t.id).padEnd(22)} ${c.dim(t.version ?? "installed")}`);

  for (const e of m.editors) {
    const name = EDITORS.find((d) => d.id === e.id)?.name ?? e.id;
    log.info(`\n${c.bold(name)}: ${e.extensions.length} extensions`);
  }
  if (m.npmGlobals.length) log.info(`\n${c.bold(`Global npm packages (${m.npmGlobals.length})`)}: ${short(m.npmGlobals, 10)}`);

  const git = Object.entries(m.git);
  if (git.length) {
    log.info(`\n${c.bold(`Git preferences (${git.length})`)}: ${short(git.map(([k, v]) => `${k}=${v.join(",")}`), 6)}`);
    log.info(c.dim("  left out: your name, email and anything pointing at your folders"));
  }
  if (m.shells.length) log.info(`\n${c.bold("Shell profiles")}: ${m.shells.map((s) => SHELL_NAMES[s]).join(", ")} ${c.dim("(contents travel with `dkit migrate export`)")}`);
  if (m.secrets.length) {
    log.info(`\n${c.bold("Secrets this setup uses")} ${c.dim("(names only, never values)")}`);
    for (const s of m.secrets) log.info(`  ${s.name.padEnd(30)} ${c.dim(s.where)}`);
  }
  if (m.project) {
    const libs = m.project.libraries.map((l) => `${nameOf(l.id)}${l.version ? ` ${l.version}` : ""}`);
    log.info(`\n${c.bold(`Project ${m.project.name ?? ""}`.trimEnd())} ${c.dim(`(${m.project.pm})`)}: ${libs.length ? libs.join(", ") : c.dim("no catalog libraries")}`);
  }
}

function resourceLine(d: ResourceDiff, os: string): string {
  const name = d.name.padEnd(22);
  switch (d.state) {
    case "ok": return `  ${c.green("✓")} ${name} ${c.dim(d.have ?? "installed")}`;
    case "older": return `  ${c.yellow("↓")} ${name} ${d.have} ${c.dim(`(manifest: ${d.want})`)}${d.hint ? c.dim(`  update: ${d.hint}`) : ""}`;
    case "missing": return `  ${c.red("✗")} ${name} ${c.dim("missing")}`;
    case "unavailable": return `  ${c.dim("–")} ${name} ${c.dim(`no installer for ${os}`)}`;
    case "unknown": return `  ${c.yellow("?")} ${name} ${c.dim("not known to this dkit version (update dkit)")}`;
  }
}

/** The comparison, section by section. */
export function printComparison(cmp: Comparison, log: Logger, os: string) {
  const m = cmp.manifest;
  log.info(c.dim(`Manifest made on ${m.source.os} ${m.source.arch}, ${m.createdAt.slice(0, 10)}`));

  if (m.tools.length) {
    log.info(c.bold("\nTools"));
    for (const t of cmp.tools) log.info(resourceLine(t, os));
  }
  if (cmp.extra.length) log.info(c.dim(`  Also on this PC, not in the manifest: ${cmp.extra.map((e) => e.name).join(", ")}`));

  const editors = cmp.editors.filter((e) => e.total);
  if (editors.length) {
    log.info(c.bold("\nEditor extensions"));
    for (const e of editors) {
      const name = e.name.padEnd(22);
      if (!e.installed) log.info(`  ${c.red("✗")} ${name} ${c.dim(`not installed: ${e.total} extensions waiting`)}`);
      else if (!e.missing.length) log.info(`  ${c.green("✓")} ${name} ${c.dim(`all ${e.total}`)}`);
      else log.info(`  ${c.red("✗")} ${name} ${e.missing.length} of ${e.total} missing: ${short(e.missing)}`);
    }
  }

  if (cmp.npm.total) {
    log.info(c.bold("\nGlobal npm packages"));
    if (!cmp.npm.checked) log.info(`  ${c.red("✗")} npm isn't installed: ${cmp.npm.total} packages waiting`);
    else if (!cmp.npm.missing.length) log.info(`  ${c.green("✓")} all ${cmp.npm.total}`);
    else log.info(`  ${c.red("✗")} missing: ${short(cmp.npm.missing)}`);
  }

  if (cmp.git.total) {
    log.info(c.bold("\nGit settings"));
    const { missing, different } = cmp.git;
    if (!cmp.git.checked) log.info(`  ${c.red("✗")} Git isn't installed: ${cmp.git.total} settings waiting`);
    else if (!missing.length && !different.length) log.info(`  ${c.green("✓")} all ${cmp.git.total} match`);
    else {
      for (const g of missing) log.info(`  ${c.red("✗")} ${g.key} = ${g.values.join(", ")} ${c.dim("not set here")}`);
      for (const g of different) log.info(`  ${c.yellow("≠")} ${g.key}: here ${g.have.join(", ")}, manifest ${g.want.join(", ")}`);
    }
  }

  if (cmp.secrets.length) {
    log.info(`${c.bold("\nSecrets")} ${c.dim("(names only: dkit never copies their values)")}`);
    for (const s of cmp.secrets) {
      const mark = s.set === undefined ? c.dim("·") : s.set ? c.green("✓") : c.red("✗");
      const state = s.set === undefined ? "check by hand" : s.set ? "set" : "not set";
      log.info(`  ${mark} ${s.name.padEnd(30)} ${state.padEnd(14)} ${c.dim(s.where)}`);
    }
  }

  if (cmp.project) {
    const { here, pm, libraries } = cmp.project;
    const from = m.project?.name ? `"${m.project.name}", ${pm}` : pm;
    log.info(c.bold(`\nProject libraries`) + c.dim(` (manifest: ${from})`));
    if (!here) log.info(c.dim(`  No project here. Run this inside the project (or with --project <folder>) to compare: ${libraries.map((l) => l.name).join(", ")}`));
    else {
      log.info(c.dim(`  in ${here.name ?? here.dir} (${here.pm})`));
      for (const l of libraries) log.info(resourceLine(l, os));
    }
  }

  const n = differenceCount(cmp);
  log.info("");
  log.info(n ? c.bold(`${n} difference(s).`) : c.green("✓ This PC matches the manifest."));
}

/**
 * Offer to fix what's missing: tools and libraries through the usual plan → confirm → install,
 * then extensions, global npm packages and safe Git settings. Nothing is ever removed or overwritten.
 */
export async function fixDifferences(cmp: Comparison, ctx: EngineContext): Promise<void> {
  const { log, runner } = ctx;
  const notes: string[] = [];

  // 1. Tools and project libraries: the shared engine (prerequisites, dependencies, verification).
  const toolIds = cmp.tools.filter((t) => t.state === "missing").map((t) => t.id);
  const libIds = cmp.project?.here ? cmp.project.libraries.filter((l) => l.state === "missing").map((l) => l.id) : [];
  if (toolIds.length || libIds.length) {
    log.info(c.bold("\nInstall what's missing"));
    await installTools([...toolIds, ...libIds], ctx);
  }

  // 2. Settings, checked again: an editor, Node.js or Git may have just been installed.
  runner.refreshPath();
  const now = compareSettings(cmp.manifest, ctx);
  const editors = now.editors.filter((e) => e.installed && e.missing.length);
  const npm = now.npm.checked ? now.npm.missing : [];
  const git = now.git.missing.filter((g) => g.safe);

  if (editors.length || npm.length || git.length) {
    log.info(c.bold("\nAlso"));
    for (const e of editors) log.info(`  ${e.name}: install ${e.missing.length} extension(s): ${short(e.missing, 8)}`);
    if (npm.length) log.info(`  runs: npm install -g ${npm.join(" ")}`);
    for (const g of git) log.info(`  runs: git config --global ${g.key} ${g.values[0]}`);

    if (ctx.dryRun) log.info(c.dim("\n[dry-run] nothing was changed"));
    else if (await ctx.confirm("\nInstall these extensions/packages and set these Git settings?")) {
      const failed: string[] = [];
      for (const e of editors) {
        const cli = EDITORS.find((d) => d.id === e.id)!.cli;
        log.step(`${e.name} extensions`);
        for (const f of await installExtensions(cli, e.missing, { runner, log, sleep: ctx.sleep })) failed.push(`${f.ext} (${f.reason})`);
      }
      if (npm.length) {
        log.step(`npm install -g ${npm.join(" ")}`);
        if (!runner.run("npm", ["install", "-g", ...npm], { inherit: true }).ok) failed.push(`npm packages: ${npm.join(", ")}`);
      }
      for (const g of git) if (!runner.run("git", ["config", "--global", g.key, g.values[0]]).ok) failed.push(`git ${g.key}`);
      if (failed.length) log.error(`Didn't work: ${failed.join("; ")}`);
      else log.ok("Extensions, packages and Git settings done");
    } else log.warn("Skipped.");
  }

  // 3. Things dkit leaves to you.
  for (const e of now.editors) if (!e.installed) notes.push(`${e.name} isn't installed, so its ${e.total} extensions weren't added. Install it (dkit install ${e.id}) and run this again.`);
  if (!now.npm.checked && now.npm.total) notes.push(`Install Node.js (dkit install node), then run this again for ${now.npm.total} global npm packages.`);
  for (const g of now.git.missing.filter((x) => !x.safe))
    notes.push(`Git ${g.key} can run programs, so dkit doesn't set it from a manifest. If you trust it: git config --global ${g.key} "${g.values[0]}"`);
  for (const g of now.git.different) notes.push(`Git ${g.key} is "${g.have.join(", ")}" here and "${g.want.join(", ")}" in the manifest. dkit leaves yours alone.`);
  for (const t of cmp.tools.filter((x) => x.state === "older"))
    notes.push(`${t.name} ${t.have} is older than the manifest's ${t.want}.${t.hint ? ` Update: ${t.hint}` : ""}`);
  for (const t of cmp.tools.filter((x) => x.state === "unavailable")) notes.push(`${t.name}: dkit has no installer for this OS. Install it yourself.`);
  for (const s of cmp.secrets.filter((x) => x.set === false)) notes.push(`Set ${s.name} (used in your ${s.where}).`);
  if (cmp.project?.here && cmp.manifest.project && cmp.project.here.pm !== cmp.manifest.project.pm)
    notes.push(`This project uses ${cmp.project.here.pm}; the manifest's used ${cmp.manifest.project.pm}. dkit used ${cmp.project.here.pm}.`);
  if (cmp.project && !cmp.project.here && cmp.project.libraries.some((l) => l.state === "missing"))
    notes.push("Project libraries weren't added: no project here. Run `dkit status <manifest> --project <folder>`.");

  if (notes.length) {
    log.info(c.bold("\nLeft for you"));
    for (const n of notes) log.info(`  • ${n}`);
  }
}
