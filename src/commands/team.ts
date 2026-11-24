import path from "node:path";
import type { Command } from "commander";
import { findRecipe } from "../core/stack.js";
import {
  BASELINE_FILE, STACKS_FOLDER, TEAM_FILE, addTeam, checkTeamUrl, findTeam, initTeam, listTeams, removeTeam, updateTeam, type Team,
} from "../core/team.js";
import { loadManifest, scanEnvironment } from "../manifest/manifest.js";
import { c } from "../utils/logger.js";
import { makeContext } from "./context.js";
import { runStatus, type StatusOpts } from "./env.js";

const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

function printTeam(t: Team, log: ReturnType<typeof makeContext>["log"]) {
  log.info(`${c.bold(t.name)}  ${c.dim(`(${t.id})`)}`);
  if (t.description) log.info(`  ${t.description}`);
  log.info(`  Baseline   ${t.baseline ? "yes: dkit team status " + t.id : c.dim("none")}`);
  log.info(`  Stacks     ${t.stacks.length ? t.stacks.map((s) => s.id).join(", ") : c.dim("none")}`);
  for (const p of t.problems) log.warn(`  Not used: ${p}`);
}

export function registerTeam(program: Command) {
  const team = program
    .command("team")
    .description("Share stacks and a baseline setup with your team through a Git repository");

  team
    .command("add <git-url>")
    .description("Connect to a team's setup repository (downloads it to ~/.dkit/teams)")
    .option("--name <id>", "short name to use for this team (default: the repository name)")
    .addHelpText("after", [
      "",
      "Examples:",
      "  dkit team add https://github.com/acme/dev-setup",
      "  dkit team add git@github.com:acme/dev-setup.git --name acme",
      "",
      "Private repositories work if `git clone <url>` works for you.",
    ].join("\n"))
    .action((url: string, opts: { name?: string }) => {
      const ctx = makeContext({});
      checkTeamUrl(url); // a bad URL fails before "Downloading" is shown
      ctx.log.step(`Downloading ${url}`);
      const t = addTeam(url, ctx, opts.name);
      ctx.log.ok(`Added team ${t.id}\n`);
      printTeam(t, ctx.log);
      ctx.log.info(c.dim(`\nNext: ${t.baseline ? `dkit team status ${t.id}   (what you're missing)` : ""}${t.stacks.length ? `   dkit stack list` : ""}`));
    });

  team
    .command("list")
    .alias("ls")
    .description("Show the teams you've added, with their stacks and baseline")
    .action(() => {
      const ctx = makeContext({});
      const { teams, problems } = listTeams(ctx.platform);
      if (!teams.length && !problems.length) {
        ctx.log.info("No teams yet. Add one with: dkit team add <git-url>");
        return;
      }
      for (const t of teams) {
        const url = ctx.runner.which("git") ? ctx.runner.run("git", ["-C", t.dir, "remote", "get-url", "origin"]).stdout.trim() : "";
        console.log("");
        printTeam(t, ctx.log);
        if (url) ctx.log.info(c.dim(`  From       ${url}`));
      }
      for (const p of problems) ctx.log.warn(`Not a usable team folder: ${p}`);
    });

  team
    .command("update [team]")
    .description("Get the latest version of your teams' setups (all of them if no name is given)")
    .action((id: string | undefined) => {
      const ctx = makeContext({});
      const teams = id ? [findTeam(ctx.platform, id)] : listTeams(ctx.platform).teams;
      if (!teams.length) throw new Error("You haven't added a team yet. Add one with: dkit team add <git-url>");
      let failed = false;
      for (const t of teams) {
        const r = updateTeam(t, ctx.runner);
        if (!r.ok) { failed = true; ctx.log.error(`${t.id}: ${r.message}`); continue; }
        ctx.log.ok(`${t.id}: ${r.changed ? "updated" : "already up to date"}`);
        if (r.changed) for (const p of findTeam(ctx.platform, t.id).problems) ctx.log.warn(`  Not used: ${p}`);
      }
      if (failed) process.exitCode = 1;
    });

  team
    .command("remove <team>")
    .description("Disconnect from a team (deletes dkit's copy; the team's repository is untouched)")
    .option("-y, --yes", "don't ask")
    .action(async (id: string, opts: { yes?: boolean }) => {
      const ctx = makeContext(opts);
      const t = findTeam(ctx.platform, id);
      if (!(await ctx.confirm(`Remove team ${t.id} (${t.dir})?`))) return;
      removeTeam(t);
      ctx.log.ok(`Removed team ${t.id}`);
    });

  team
    .command("status [team]")
    .description("Compare this machine with your team's baseline and offer to install what's missing")
    .option("-p, --project <folder>", "project to compare libraries in (default: the current folder)")
    .option("--pm <name>", "package manager for adding libraries (default: detected from the project)")
    .option("--check", "only report; exit with code 1 if anything differs (for scripts and CI)")
    .option("--offline", "don't fetch the team's latest version first")
    .option("--dry-run", "show what would be installed, change nothing")
    .option("-y, --yes", "install without asking")
    .action(async (id: string | undefined, opts: StatusOpts & { offline?: boolean }) => {
      const ctx = makeContext(opts);
      let t = findTeam(ctx.platform, id);
      if (!opts.offline) {
        const r = updateTeam(t, ctx.runner);
        if (!r.ok) ctx.log.warn(`Couldn't fetch the latest version of ${t.id} (${r.message}). Using the copy you have.`);
        else if (r.changed) t = findTeam(ctx.platform, t.id);
      }
      for (const p of t.problems) ctx.log.warn(`Not used: ${p}`);
      if (!t.baseline) throw new Error(`Team ${t.id} has no ${BASELINE_FILE}. Whoever maintains it can add one with: dkit scan -o ${BASELINE_FILE}`);
      const manifest = await loadManifest(t.baseline);
      await runStatus(manifest, `team ${t.id}`, opts);
    });

  team
    .command("init [folder]")
    .description("Start a team setup repository: a team file, a baseline from this machine, and your stacks")
    .requiredOption("--name <text>", "the team's display name, e.g. \"Acme web team\"")
    .option("--description <text>", "one line about what this setup is for")
    .option("--stacks <ids>", "stacks to include, comma-separated (yours, built-in, or other teams')")
    .option("--no-baseline", "don't create baseline.json from this machine")
    .option("-f, --force", "replace an existing team file")
    .action((folder: string | undefined, opts: { name: string; description?: string; stacks?: string; baseline: boolean; force?: boolean }) => {
      const ctx = makeContext({});
      const dir = path.resolve(folder ?? ".");
      const stacks = list(opts.stacks).map((s) => findRecipe(s, ctx.platform));
      const baseline = opts.baseline ? scanEnvironment(ctx) : undefined;
      const files = initTeam(dir, { name: opts.name, description: opts.description, baseline, stacks, force: opts.force });
      ctx.log.info(c.bold(`Team setup created in ${dir}`));
      for (const f of files) ctx.log.ok(path.relative(dir, f).split(path.sep).join("/"));
      ctx.log.info(c.bold("\nNext"));
      if (baseline) ctx.log.info(`  1. Open ${BASELINE_FILE} and remove anything that isn't for the whole team (it was made from this PC; it has no secrets or personal details).`);
      ctx.log.info(`  ${baseline ? 2 : 1}. Add stacks any time: copy files from ~/.dkit/stacks into ${STACKS_FOLDER}/ (or rerun with --stacks).`);
      ctx.log.info(`  ${baseline ? 3 : 2}. Put it on GitHub (or any Git host), for example:`);
      ctx.log.info(c.dim(`       cd "${dir}"`));
      ctx.log.info(c.dim(`       git init; git add ${TEAM_FILE} ${baseline ? BASELINE_FILE + " " : ""}${stacks.length ? STACKS_FOLDER : ""}`.trimEnd()));
      ctx.log.info(c.dim(`       git commit -m "Team dev setup"`));
      ctx.log.info(c.dim(`       gh repo create --private --source . --push`));
      ctx.log.info(`  Teammates then run: ${c.cyan("dkit team add <repo-url>")}`);
    });
}
