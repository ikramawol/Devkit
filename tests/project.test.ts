import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildPlan, executePlan, installTools } from "../src/core/engine.js";
import { addCommand, readProject, type ProjectInfo } from "../src/core/project.js";
import type { RunResult } from "../src/utils/run.js";
import { engineCtx, fail, fakeRunner, ok, tempPlatform } from "./helpers.js";

const win = tempPlatform("windows");

/** A real project folder: package.json plus optional extra files (lockfiles). */
function makeProject(pkg: object, files: Record<string, string> = {}): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "dkit-proj-"));
  writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg, null, 2));
  for (const [f, content] of Object.entries(files)) writeFileSync(path.join(dir, f), content);
  return dir;
}

const pkgJson = (dir: string) => JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));

/**
 * A fake machine whose package managers edit package.json in the folder they run in, like the real ones.
 * Records each package-manager run with its folder.
 */
function pmMachine(installed: string[], opts: { failAdd?: boolean } = {}) {
  const { runner, calls } = fakeRunner({ installed: new Set(installed) });
  const runs: { line: string; cwd?: string }[] = [];
  const run = runner.run;
  runner.run = (cmd, args = [], o): RunResult => {
    const pm = ["npm", "pnpm", "yarn", "bun"].find((p) => cmd === p);
    if (pm && (args[0] === "add" || (pm === "npm" && args[0] === "install" && !args.includes("-g")))) {
      runs.push({ line: `${cmd} ${args.join(" ")}`, cwd: o?.cwd });
      if (opts.failAdd) return fail("network error");
      const dev = args.includes("-D") || args.includes("-d");
      const pkgs = args.slice(1).filter((a) => !a.startsWith("-"));
      const file = path.join(o!.cwd!, "package.json");
      const data = JSON.parse(readFileSync(file, "utf8"));
      const key = dev ? "devDependencies" : "dependencies";
      data[key] = { ...data[key], ...Object.fromEntries(pkgs.map((p) => [p, "^1.0.0"])) };
      writeFileSync(file, JSON.stringify(data));
      return ok();
    }
    return run(cmd, args, o);
  };
  return { runner, calls, runs };
}

const ctxFor = (runner: ReturnType<typeof pmMachine>["runner"], dir: string, extra = {}) => {
  const project = readProject(dir) ?? undefined;
  return engineCtx(runner, win, { projectDir: dir, project, ...extra });
};

// ── Reading a project ───────────────────────────────────────

test("package manager comes from packageManager, then the lockfile, else npm", () => {
  const cases: [object, Record<string, string>, string][] = [
    [{}, {}, "npm"],
    [{}, { "pnpm-lock.yaml": "" }, "pnpm"],
    [{}, { "yarn.lock": "" }, "yarn"],
    [{}, { "bun.lock": "" }, "bun"],
    [{}, { "package-lock.json": "{}" }, "npm"],
    [{ packageManager: "pnpm@9.12.0" }, { "package-lock.json": "{}" }, "pnpm"], // declared wins over a stray lockfile
  ];
  for (const [pkg, files, pm] of cases) assert.equal(readProject(makeProject(pkg, files))?.pm, pm, JSON.stringify(files));
  assert.equal(readProject(makeProject({}, { "yarn.lock": "" }), { pm: "bun" })?.pm, "bun", "--pm overrides everything");
});

test("no package.json = no project; broken package.json = clear error", () => {
  assert.equal(readProject(mkdtempSync(path.join(os.tmpdir(), "dkit-empty-"))), null);
  const dir = makeProject({});
  writeFileSync(path.join(dir, "package.json"), "{ not json");
  assert.throws(() => readProject(dir), /isn't valid JSON/);
});

test("add commands per package manager", () => {
  assert.deepEqual(addCommand("npm", ["hono"], false), { command: "npm", args: ["install", "hono"] });
  assert.deepEqual(addCommand("pnpm", ["drizzle-kit"], true), { command: "pnpm", args: ["add", "-D", "drizzle-kit"] });
  assert.deepEqual(addCommand("yarn", ["prisma"], true), { command: "yarn", args: ["add", "-D", "prisma"] });
  assert.deepEqual(addCommand("bun", ["dbmate"], true), { command: "bun", args: ["add", "-d", "dbmate"] });
});

// ── Planning ────────────────────────────────────────────────

test("inside a pnpm project: only the missing libraries are planned", () => {
  const dir = makeProject({ name: "my-api", dependencies: { kysely: "^0.27.0" } }, { "pnpm-lock.yaml": "" });
  const { runner } = pmMachine(["node", "pnpm"]);
  const plan = buildPlan(["hono", "kysely", "dbmate"], ctxFor(runner, dir));
  assert.deepEqual(plan.projectAdd.map((i) => i.id), ["hono", "dbmate"]);
  const kysely = plan.alreadyInstalled.find((s) => s.id === "kysely");
  assert.equal(kysely?.version, "0.27.0", "version read from package.json");
  assert.deepEqual(plan.alreadyInstalled.map((s) => s.id).sort(), ["kysely", "node", "pnpm"], "Node and pnpm shown as ready too");
  assert.equal(plan.toInstall.length, 0, "Node and pnpm are already there");
});

test("pnpm project on a PC without pnpm: pnpm is installed first", () => {
  const dir = makeProject({}, { "pnpm-lock.yaml": "" });
  const { runner } = pmMachine(["node"]);
  const plan = buildPlan(["hono"], ctxFor(runner, dir));
  assert.deepEqual(plan.toInstall.map((i) => i.id), ["pnpm"]);
  assert.deepEqual(plan.addedDeps, ["pnpm"]);
  assert.deepEqual(plan.projectAdd.map((i) => i.id), ["hono"]);
});

test("bun project needs Bun, not Node.js", () => {
  const dir = makeProject({}, { "bun.lock": "" });
  const { runner } = pmMachine([]);
  assert.deepEqual(buildPlan(["hono"], ctxFor(runner, dir)).toInstall.map((i) => i.id), ["bun"]);
});

test("machine tools and libraries in one command", () => {
  const dir = makeProject({});
  const { runner } = pmMachine(["node"]);
  const plan = buildPlan(["gh", "hono"], ctxFor(runner, dir));
  assert.deepEqual(plan.toInstall.map((i) => i.id), ["gh"]);
  assert.deepEqual(plan.projectAdd.map((i) => i.id), ["hono"]);
});

// ── Installing ──────────────────────────────────────────────

test("libraries are added in the project folder, one command for deps and one for dev deps", async () => {
  const dir = makeProject({ name: "my-api" }, { "pnpm-lock.yaml": "" });
  const { runner, runs } = pmMachine(["node", "pnpm"]);
  const ctx = ctxFor(runner, dir);
  const report = await executePlan(buildPlan(["hono", "kysely", "drizzle", "dbmate"], ctx), ctx);

  assert.deepEqual(runs.map((r) => r.line), ["pnpm add hono kysely drizzle-orm", "pnpm add -D drizzle-kit dbmate"]);
  assert.ok(runs.every((r) => r.cwd === dir), "runs inside the project");
  assert.deepEqual(report.results.map((r) => [r.id, r.outcome]), [
    ["hono", "installed"], ["kysely", "installed"], ["drizzle", "installed"], ["dbmate", "installed"],
  ]);
  const pkg = pkgJson(dir);
  assert.ok(pkg.dependencies["drizzle-orm"] && pkg.devDependencies["drizzle-kit"]);
});

test("if the package manager fails, the libraries are reported as failed", async () => {
  const dir = makeProject({});
  const { runner } = pmMachine(["node"], { failAdd: true });
  const ctx = ctxFor(runner, dir);
  const report = await executePlan(buildPlan(["prisma"], ctx), ctx);
  assert.equal(report.results[0].outcome, "failed");
  assert.deepEqual(pkgJson(dir), {}, "package.json untouched");
});

test("outside a project: libraries are refused with a clear reason, nothing runs", async () => {
  const empty = mkdtempSync(path.join(os.tmpdir(), "dkit-notproj-"));
  const { runner, runs } = pmMachine(["node"]);
  const report = await installTools(["hono"], ctxFor(runner, empty));
  assert.deepEqual(report?.results.map((r) => [r.id, r.outcome, r.message]), [["hono", "skipped", "no project"]]);
  assert.equal(runs.length, 0);
});

test("dry run shows the libraries but changes nothing", async () => {
  const dir = makeProject({});
  const { runner, runs } = pmMachine(["node"]);
  await installTools(["hono", "better-auth"], ctxFor(runner, dir, { dryRun: true }));
  assert.equal(runs.length, 0);
  assert.deepEqual(pkgJson(dir), {});
});

test("migrate export records machine tools only, never project libraries", async () => {
  const { createBackup } = await import("../src/migrate/export.js");
  const { silentLogger } = await import("../src/utils/logger.js");
  const { runner } = fakeRunner({ installed: new Set(["git"]) });
  const backup = createBackup({ runner, platform: tempPlatform("windows"), log: silentLogger });
  assert.ok(backup.tools.includes("git"));
  assert.ok(!backup.tools.some((t) => ["hono", "kysely", "drizzle", "prisma", "dbmate", "better-auth"].includes(t)));
});

// Keep the type import used.
export type { ProjectInfo };
