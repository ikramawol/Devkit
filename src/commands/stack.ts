import path from "node:path";
import type { Command } from "commander";
import { getItem } from "../core/catalog.js";
import { detectItem } from "../core/detect.js";
import { PACKAGE_MANAGERS, detectInProject, readProject, type PackageManager } from "../core/project.js";
import {
  customizeRecipe, findRecipe, installStack, listRecipes, saveRecipe, stacksDir, type Recipe,
} from "../core/stack.js";
import { describeSteps, getStarter, STARTERS } from "../core/starters.js";
import { c } from "../utils/logger.js";
import { makeContext, type CommonOpts } from "./context.js";

const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

function checkPm(pm?: string): PackageManager | undefined {
  if (pm && !PACKAGE_MANAGERS.includes(pm as PackageManager)) throw new Error(`Unknown package manager "${pm}". Use one of: ${PACKAGE_MANAGERS.join(", ")}.`);
  return pm as PackageManager | undefined;
}

export function registerStack(program: Command) {
  const stack = program
    .command("stack")
    .description("Stack recipes: ready-made combinations of tools and libraries, optionally creating a new project");

  stack
    .command("list")
    .description("Show built-in, saved and team stacks")
    .action(() => {
      const ctx = makeContext({});
      const { recipes, problems } = listRecipes(ctx.platform);
      const groups: [string, typeof recipes][] = [
        ["\nBuilt-in stacks", recipes.filter((r) => r.source === "built-in")],
        [`\nYour stacks  ${c.dim(stacksDir(ctx.platform))}`, recipes.filter((r) => r.source === "saved")],
      ];
      for (const team of [...new Set(recipes.filter((r) => r.source === "team").map((r) => r.team!))])
        groups.push([`\nTeam ${team}  ${c.dim("(use as " + team + "/<id> if the id clashes)")}`, recipes.filter((r) => r.team === team)]);
      for (const [title, rs] of groups) {
        if (!rs.length) continue;
        console.log(c.bold(title));
        for (const r of rs) {
          console.log(`  ${c.cyan(r.id.padEnd(16))} ${r.name}`);
          if (r.description) console.log(`  ${" ".repeat(16)} ${c.dim(r.description)}`);
        }
      }
      for (const p of problems) ctx.log.warn(`Skipped a saved stack: ${p}`);
      console.log(c.dim("\nDetails: dkit stack info <id>   New project: dkit stack install <id> --project <new-folder>"));
    });

  stack
    .command("info <stack>")
    .description("What a stack contains, and what you already have")
    .action((ref: string) => {
      const ctx = makeContext({});
      const r = findRecipe(ref, ctx.platform);
      const project = readProject(process.cwd()) ?? undefined;
      console.log(`${c.bold(r.name)}  ${c.dim(`(${r.id}, ${r.source}${r.path ? `: ${r.path}` : ""})`)}`);
      if (r.description) console.log(r.description);

      const starter = r.starter ? getStarter(r.starter) : undefined;
      console.log(`\n${c.bold("New project starter")}`);
      if (starter) {
        console.log(`  ${starter.name}: ${c.dim(starter.description)}`);
        for (const s of describeSteps(starter, r.pm ?? "npm", "<folder>")) console.log(c.dim(`  runs: ${s}`));
      } else console.log(c.dim("  none: this stack can only be added to an existing project"));

      console.log(`\n${c.bold("Machine tools")}`);
      for (const id of r.machine) {
        const s = detectItem(getItem(id)!, ctx);
        console.log(`  ${s.installed ? c.green("✓") : c.dim("·")} ${getItem(id)!.name.padEnd(22)} ${c.dim(s.installed ? s.version ?? "installed" : "not installed")}`);
      }
      console.log(`\n${c.bold("Libraries")}${project ? c.dim(`  (checked in ${project.name ?? project.dir})`) : ""}`);
      for (const id of r.libraries) {
        const item = getItem(id)!;
        const s = project ? detectInProject(item, project) : undefined;
        const mark = s?.installed ? c.green("✓") : c.dim("·");
        const deps = [...(item.packages?.deps ?? []), ...(item.packages?.dev ?? []).map((d) => `${d} (dev)`)].join(", ");
        console.log(`  ${mark} ${item.name.padEnd(22)} ${c.dim(s?.installed ? `in project ${s.version ?? ""}` : deps)}`);
      }
      for (const n of r.notes ?? []) console.log(c.dim(`\n  • ${n}`));
      console.log(c.dim(`\nCustomize: --without ${r.libraries[r.libraries.length - 1] ?? "<id>"}  --with <id>   Save yours: dkit stack save my-stack --from ${r.id}`));
    });

  stack
    .command("install <stack>")
    .description("Create a new project from a stack, or add a stack to the project you're in")
    .option("-p, --project <folder>", "new folder to create the project in, or an existing project (default: the current folder)")
    .option("--pm <name>", `package manager: ${PACKAGE_MANAGERS.join(", ")} (default: the project's, or npm for new projects)`)
    .option("--with <ids>", "add tools or libraries, comma-separated (e.g. --with prisma)")
    .option("--without <ids>", "leave out parts of the stack, comma-separated (e.g. --without drizzle)")
    .option("--dry-run", "show the plan without changing anything")
    .option("-y, --yes", "don't ask; keep every component")
    .addHelpText("after", [
      "",
      "Examples:",
      "  dkit stack install hono-api --project my-api                 create a new project",
      "  dkit stack install solid-hono                                inside an existing project: add what's missing",
      "  dkit stack install next-hono --project web --without drizzle --with prisma",
      "  dkit stack install ./team-stack.json --project app           a shared recipe file",
    ].join("\n"))
    .action(async (ref: string, opts: CommonOpts & { project?: string; pm?: string; with?: string; without?: string }) => {
      const ctx = makeContext(opts);
      const recipe = customizeRecipe(findRecipe(ref, ctx.platform), { with: list(opts.with), without: list(opts.without) });
      const report = await installStack(recipe, ctx, {
        projectDir: path.resolve(opts.project ?? "."),
        explicitProject: !!opts.project,
        pm: checkPm(opts.pm),
      });
      if (report?.results.some((r) => r.outcome === "failed" || r.outcome === "skipped")) process.exitCode = 1;
    });

  stack
    .command("save <id>")
    .description("Save your own stack (from an existing one, or from scratch) as a shareable JSON file")
    .option("--from <stack>", "start from this stack")
    .option("--with <ids>", "tools or libraries to add, comma-separated")
    .option("--without <ids>", "parts of --from to leave out, comma-separated")
    .option("--starter <id>", `starter for new projects: ${STARTERS.map((s) => s.id).join(", ")}`)
    .option("--name <text>", "display name")
    .option("--description <text>", "one-line description")
    .option("--pm <name>", "package manager for new projects")
    .option("--force", "replace a saved stack with the same id")
    .addHelpText("after", [
      "",
      "Examples:",
      "  dkit stack save my-api --from hono-api --without drizzle --with kysely,dbmate",
      "  dkit stack save tools-only --with git,node,vscode,docker",
      "",
      "Saved to ~/.dkit/stacks/<id>.json. Share it by sending the file; others run: dkit stack install ./<id>.json",
    ].join("\n"))
    .action((id: string, opts: { from?: string; with?: string; without?: string; starter?: string; name?: string; description?: string; pm?: string; force?: boolean }) => {
      const ctx = makeContext({});
      const base: Recipe = opts.from
        ? findRecipe(opts.from, ctx.platform)
        : { id, name: id, description: "", machine: [], libraries: [] };
      const { machine, libraries } = customizeRecipe(base, { with: list(opts.with), without: list(opts.without) });
      const recipe: Recipe = {
        machine,
        libraries,
        notes: base.notes,
        id: id.toLowerCase(),
        name: opts.name ?? (opts.from ? `${base.name} (${id})` : id),
        description: opts.description ?? base.description,
        starter: opts.starter ?? base.starter,
        pm: checkPm(opts.pm) ?? base.pm,
      };
      const file = saveRecipe(recipe, ctx.platform, opts.force);
      ctx.log.ok(`Saved ${recipe.name}: ${file}`);
      ctx.log.info(c.dim(`Use it: dkit stack install ${recipe.id} --project <folder>   Share it: send ${path.basename(file)}`));
    });
}
