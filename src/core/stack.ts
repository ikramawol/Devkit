import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { c } from "../utils/logger.js";
import type { Select } from "../utils/prompt.js";
import { getItem } from "./catalog.js";
import {
  buildPlan, executePlan, installTools, printPlan, printReport, type EngineContext, type InstallReport,
} from "./engine.js";
import type { PlatformInfo } from "./platform.js";
import { PACKAGE_MANAGERS, pmRequires, readProject, type PackageManager } from "./project.js";
import { checkNewProjectDir, describeSteps, getStarter, runStarter, starterRequires, STARTERS } from "./starters.js";

/**
 * A stack recipe: a reusable combination of catalog resources, plus an optional starter
 * for creating a new project. Recipes only *reference* catalog ids and starter ids, they
 * never carry commands, so a recipe file from someone else can't run anything unexpected.
 */
export interface Recipe {
  id: string;
  name: string;
  description: string;
  /** Starter used when creating a new project (see starters.ts). */
  starter?: string;
  /** Machine tools (kind "machine"), e.g. node, postgresql. */
  machine: string[];
  /** Project libraries (kind "project"), e.g. hono, drizzle. */
  libraries: string[];
  /** Package manager for new projects (default npm; --pm wins). */
  pm?: PackageManager;
  notes?: string[];
}

export type RecipeSource = "built-in" | "saved" | "file";
export interface LoadedRecipe extends Recipe {
  source: RecipeSource;
  path?: string;
}

const DB = ["node", "postgresql"];

export const BUILTIN_RECIPES: Recipe[] = [
  {
    id: "next-hono",
    name: "Next.js + Hono + Better Auth + PostgreSQL + Drizzle",
    description: "Full-stack React app with a Hono API, auth, and a typed PostgreSQL ORM.",
    starter: "next",
    machine: DB,
    libraries: ["hono", "better-auth", "drizzle", "pg"],
    notes: ["Serve Hono from Next.js in app/api/[[...route]]/route.ts with `handle(app)` from hono/vercel."],
  },
  {
    id: "solid-hono",
    name: "SolidJS + Hono + PostgreSQL + Kysely + dbmate",
    description: "SolidJS front end, Hono API, type-safe SQL with Kysely, plain-SQL migrations with dbmate. Auth is up to you.",
    starter: "solid",
    machine: DB,
    libraries: ["hono", "kysely", "pg", "dbmate"],
  },
  {
    id: "hono-api",
    name: "Hono API + PostgreSQL + Drizzle",
    description: "A backend-only API: Hono server with Drizzle ORM on PostgreSQL.",
    starter: "hono",
    machine: DB,
    libraries: ["hono", "drizzle", "pg"],
  },
  {
    id: "express-prisma",
    name: "Express + PostgreSQL + Prisma",
    description: "Classic Express API with Prisma ORM on PostgreSQL.",
    starter: "node",
    machine: DB,
    libraries: ["express", "prisma"],
  },
];

// ── Validation (recipes may come from files other people wrote) ─────────

const ID = /^[a-z0-9][a-z0-9-]{0,49}$/;
const ALLOWED_KEYS = new Set(["format", "version", "id", "name", "description", "starter", "machine", "libraries", "pm", "notes"]);

/** Check a recipe strictly. Unknown keys are refused, so nothing can sneak in alongside the ids. */
export function validateRecipe(data: unknown, where = "recipe"): Recipe {
  const fail = (msg: string): never => { throw new Error(`${where}: ${msg}`); };
  if (!data || typeof data !== "object" || Array.isArray(data)) fail("not a recipe object");
  const r = data as Record<string, unknown>;
  const extra = Object.keys(r).filter((k) => !ALLOWED_KEYS.has(k));
  if (extra.length) fail(`unknown field(s) ${extra.join(", ")}. Recipes can only list catalog ids and a starter.`);
  if (r.format !== undefined && r.format !== "dkit-stack") fail(`format must be "dkit-stack"`);
  if (r.version !== undefined && r.version !== 1) fail(`unsupported version ${String(r.version)}. Update dkit.`);
  if (typeof r.id !== "string" || !ID.test(r.id)) fail("id must be lowercase letters, digits and dashes");
  if (typeof r.name !== "string" || !r.name.trim()) fail("name is required");
  const strings = (k: string) => {
    const v = r[k] ?? [];
    if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) fail(`${k} must be a list of ids`);
    return v as string[];
  };
  const machine = strings("machine");
  const libraries = strings("libraries");
  for (const id of machine) {
    const item = getItem(id);
    if (!item) fail(`unknown tool "${id}" (see \`dkit catalog\`)`);
    else if (item.kind !== "machine") fail(`"${id}" is a project library: put it under libraries`);
  }
  for (const id of libraries) {
    const item = getItem(id);
    if (!item) fail(`unknown library "${id}" (see \`dkit catalog\`)`);
    else if (item.kind !== "project") fail(`"${id}" is a machine tool: put it under machine`);
  }
  if (!machine.length && !libraries.length) fail("a recipe needs at least one tool or library");
  if (r.starter !== undefined && (typeof r.starter !== "string" || !getStarter(r.starter)))
    fail(`unknown starter "${String(r.starter)}". Available: ${STARTERS.map((s) => s.id).join(", ")}`);
  if (r.pm !== undefined && !PACKAGE_MANAGERS.includes(r.pm as PackageManager)) fail(`pm must be one of ${PACKAGE_MANAGERS.join(", ")}`);
  const notes = r.notes === undefined ? undefined : strings("notes");
  return {
    id: r.id as string,
    name: (r.name as string).trim(),
    description: typeof r.description === "string" ? r.description : "",
    starter: r.starter as string | undefined,
    machine,
    libraries,
    pm: r.pm as PackageManager | undefined,
    notes,
  };
}

// ── Finding and saving recipes ──────────────────────────────

/** Your own recipes live here, one JSON file each. Copy a file to share it. */
export const stacksDir = (platform: PlatformInfo) => path.join(platform.home, ".dkit", "stacks");

export function listRecipes(platform: PlatformInfo): { recipes: LoadedRecipe[]; problems: string[] } {
  const recipes: LoadedRecipe[] = BUILTIN_RECIPES.map((r) => ({ ...r, source: "built-in" }));
  const problems: string[] = [];
  const dir = stacksDir(platform);
  if (existsSync(dir)) {
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
      const p = path.join(dir, f);
      try {
        const r = validateRecipe(JSON.parse(readFileSync(p, "utf8")), p);
        if (!recipes.some((x) => x.id === r.id)) recipes.push({ ...r, source: "saved", path: p });
      } catch (e) {
        problems.push(e instanceof Error ? e.message : String(e));
      }
    }
  }
  return { recipes, problems };
}

/** A recipe id (built-in or saved), or a path to a recipe .json file. */
export function findRecipe(ref: string, platform: PlatformInfo): LoadedRecipe {
  if (ref.toLowerCase().endsWith(".json") || /[\\/]/.test(ref)) {
    const p = path.resolve(ref);
    if (!existsSync(p)) throw new Error(`Recipe file not found: ${p}`);
    let data: unknown;
    try { data = JSON.parse(readFileSync(p, "utf8")); } catch { throw new Error(`${p} isn't valid JSON.`); }
    return { ...validateRecipe(data, p), source: "file", path: p };
  }
  const found = listRecipes(platform).recipes.find((r) => r.id === ref.toLowerCase());
  if (!found) throw new Error(`Unknown stack "${ref}". See \`dkit stack list\`.`);
  return found;
}

/** Add and remove components: --with prisma --without drizzle. */
export function customizeRecipe(base: Recipe, change: { with?: string[]; without?: string[] }): Recipe {
  const without = new Set(change.without ?? []);
  for (const id of without) {
    if (!base.machine.includes(id) && !base.libraries.includes(id)) throw new Error(`"${id}" isn't part of ${base.name}, so it can't be removed.`);
  }
  const machine = base.machine.filter((id) => !without.has(id));
  const libraries = base.libraries.filter((id) => !without.has(id));
  for (const id of change.with ?? []) {
    const item = getItem(id);
    if (!item) throw new Error(`Unknown tool or library "${id}" (see \`dkit catalog\`).`);
    const list = item.kind === "machine" ? machine : libraries;
    if (!list.includes(id)) list.push(id);
  }
  return { ...base, machine, libraries };
}

export function saveRecipe(recipe: Recipe, platform: PlatformInfo, force = false): string {
  if (BUILTIN_RECIPES.some((r) => r.id === recipe.id)) throw new Error(`"${recipe.id}" is a built-in stack. Save yours under another id.`);
  const clean = validateRecipe({ format: "dkit-stack", version: 1, ...recipe }, recipe.id);
  const dir = stacksDir(platform);
  const file = path.join(dir, `${clean.id}.json`);
  if (existsSync(file) && !force) throw new Error(`You already have a stack "${clean.id}" (${file}). Use --force to replace it.`);
  mkdirSync(dir, { recursive: true });
  const out: Record<string, unknown> = { format: "dkit-stack", version: 1, ...clean };
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  return file;
}

// ── Installing a stack ──────────────────────────────────────

export interface StackOptions {
  /** Absolute project folder: --project, or the current folder. */
  projectDir: string;
  /** True when the user passed --project (needed before dkit creates a new project). */
  explicitProject: boolean;
  pm?: PackageManager;
}

const names = (ids: string[]) => ids.map((id) => getItem(id)?.name ?? id).join(", ");

/**
 * Inside an existing project: add whatever of the stack is missing.
 * With --project <new folder>: install the machine tools, create the project with the starter, then add the libraries.
 */
export async function installStack(
  recipe: Recipe,
  ctx: EngineContext & { select: Select },
  opts: StackOptions,
): Promise<InstallReport | null> {
  const { log } = ctx;

  // Let the user drop components they don't want (all are picked by default; --yes keeps them all).
  const all = [...recipe.machine, ...recipe.libraries];
  const chosen = new Set(await ctx.select(
    `${recipe.name}: uncheck anything you don't want`,
    all.map((id) => {
      const item = getItem(id)!;
      return { value: id, name: `${item.name}  ${c.dim(item.kind === "machine" ? "tool" : "library")}`, checked: true };
    }),
  ));
  const machine = recipe.machine.filter((id) => chosen.has(id));
  const libraries = recipe.libraries.filter((id) => chosen.has(id));
  if (!machine.length && !libraries.length) {
    log.info("Nothing selected.");
    return null;
  }

  // ── Existing project: just add what's missing ──
  const existing = readProject(opts.projectDir, { pm: opts.pm });
  if (existing) {
    log.info(c.bold(`Adding ${recipe.name} to ${existing.name ?? existing.dir}`) + c.dim("  (project exists, so no starter)"));
    const report = await installTools([...machine, ...libraries], { ...ctx, project: existing, projectDir: existing.dir });
    if (report?.results.length) for (const n of recipe.notes ?? []) log.info(c.dim(`  • ${n}`));
    return report;
  }

  // ── New project ──
  const starter = recipe.starter ? getStarter(recipe.starter) : undefined;
  if (!starter) {
    throw new Error(`${recipe.name} has no starter, so it can only be added to an existing project: run it inside one, or use --project <folder with a package.json>.`);
  }
  if (!opts.explicitProject) {
    throw new Error(
      `There's no package.json here.\n` +
      `  To create a new project: dkit stack install ${recipe.id} --project <new-folder>\n` +
      `  To add this stack to an existing project: run it inside that project.`,
    );
  }
  const dirProblem = checkNewProjectDir(opts.projectDir);
  if (dirProblem) throw new Error(dirProblem);

  const pm = opts.pm ?? recipe.pm ?? "npm";
  const needed = [...new Set([...machine, ...starterRequires(pm), ...pmRequires(pm)])];
  const machinePlan = buildPlan(needed, ctx);
  printPlan(machinePlan, ctx);

  const name = path.basename(opts.projectDir);
  log.info(c.bold(`\nWill create ${name}`) + c.dim(`  ${opts.projectDir} · ${starter.name} · ${pm}`));
  for (const s of describeSteps(starter, pm, name)) log.info(c.dim(`  runs: ${s}`));
  if (libraries.length) log.info(c.bold("Then add to it: ") + names(libraries));

  const blockedTool = machinePlan.blocked.find((i) => [...starterRequires(pm), ...pmRequires(pm)].includes(i.id));
  if (blockedTool) throw new Error(`${blockedTool.name} is needed to create the project, but it needs a manual step first (see above).`);
  if (ctx.dryRun) {
    log.info(c.dim("\n[dry-run] nothing was changed"));
    return null;
  }
  if (!(await ctx.confirm(`\nCreate ${name} with ${recipe.name}?`))) {
    log.warn("Cancelled. Nothing was changed.");
    return null;
  }

  // 1. Machine tools (Node.js, the package manager, PostgreSQL...).
  const report = await executePlan(machinePlan, ctx);
  const failedTool = report.results.find((r) => needed.includes(r.id) && (r.outcome === "failed" || r.outcome === "skipped") &&
    [...starterRequires(pm), ...pmRequires(pm)].includes(r.id));
  if (failedTool) {
    log.error(`${failedTool.name} couldn't be installed, so the project wasn't created.`);
    printReport(report, machinePlan, log);
    return report;
  }

  // 2. The project itself, with the framework's own starter.
  ctx.runner.refreshPath();
  log.step(`Creating ${name} with ${starter.name}…`);
  const starterError = runStarter(starter, pm, opts.projectDir, ctx.runner);
  const projectLabel = `New project ${name} (${starter.name})`;
  if (starterError) {
    log.error(starterError);
    report.results.push({ id: `starter:${starter.id}`, name: projectLabel, outcome: "failed", message: starterError });
    printReport(report, machinePlan, log);
    return report;
  }
  log.ok(`Created ${opts.projectDir}`);
  report.results.push({ id: `starter:${starter.id}`, name: projectLabel, outcome: "installed" });

  // 3. Libraries, into the new project (the starter may already have added some, e.g. Hono).
  const project = readProject(opts.projectDir, { pm })!;
  const libCtx = { ...ctx, project, projectDir: project.dir };
  const libPlan = buildPlan(libraries, libCtx);
  for (const s of libPlan.alreadyInstalled.filter((s) => libraries.includes(s.id))) log.ok(`${s.name} ${c.dim("already added by the starter")}`);
  const libReport = await executePlan(libPlan, libCtx);

  report.results.push(...libReport.results);
  report.notes.push(...libReport.notes, ...(starter.notes ?? []), ...(recipe.notes ?? []), `Next: cd "${opts.projectDir}"`);
  report.restartFor.push(...libReport.restartFor);
  printReport(report, { ...libPlan, blocked: machinePlan.blocked, manual: machinePlan.manual }, log);
  return report;
}
