import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildPlan } from "../src/core/engine.js";
import {
  addCommand, detectInProject, parseGoMod, parsePubspec, parseRequirements, readProject,
} from "../src/core/project.js";
import { findRecipe, installStack, validateRecipe } from "../src/core/stack.js";
import { dartName } from "../src/core/starters.js";
import { getItem } from "../src/core/catalog.js";
import type { RunResult } from "../src/utils/run.js";
import type { Choice } from "../src/utils/prompt.js";
import { engineCtx, fakeRunner, ok, tempPlatform } from "./helpers.js";

const tmp = (prefix: string) => mkdtempSync(path.join(os.tmpdir(), prefix));
const keepAll = async (_m: string, choices: Choice[]) => choices.filter((ch) => ch.checked).map((ch) => ch.value);

/**
 * A fake PC with Python, Go and Flutter. Their commands change the project files the way the real ones do:
 * venv makes .venv, `go mod init` writes go.mod, `go get` adds requires, `flutter create`/`pub add` edit pubspec.yaml.
 */
function polyglotMachine() {
  const { runner } = fakeRunner({ installed: new Set(["python", "go", "flutter", "git", "psql", "memurai", "winget"]) });
  const log: { line: string; cwd?: string }[] = [];
  const base = runner.run;
  runner.run = (cmd, args = [], o): RunResult => {
    const cwd = o?.cwd ?? "";
    const line = `${cmd} ${args.join(" ")}`;
    if (args[0] === "--version" || args[0] === "version" || cmd === "winget") return base(cmd, args, o);
    log.push({ line, cwd });
    if (cmd === "python" && args.join(" ") === "-m venv .venv") {
      mkdirSync(path.join(cwd, ".venv", "Scripts"), { recursive: true });
      writeFileSync(path.join(cwd, ".venv", "Scripts", "python.exe"), "");
    } else if (cmd === "go" && args[0] === "mod") {
      writeFileSync(path.join(cwd, "go.mod"), `module ${args[2]}\n\ngo 1.27\n`);
    } else if (cmd === "go" && args[0] === "get") {
      appendFileSync(path.join(cwd, "go.mod"), args.slice(1).map((p) => `require ${p} v1.0.0\n`).join(""));
    } else if (cmd === "flutter" && args[0] === "create") {
      const dir = path.join(cwd, args[3]);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "pubspec.yaml"), `name: ${args[2]}\n\ndependencies:\n  flutter:\n    sdk: flutter\n\ndev_dependencies:\n  flutter_test:\n    sdk: flutter\n`);
    } else if (cmd === "flutter" && args[0] === "pub") {
      const file = path.join(cwd, "pubspec.yaml");
      const text = readFileSync(file, "utf8").replace("dependencies:\n", `dependencies:\n${args.slice(2).map((p) => `  ${p}: ^1.0.0\n`).join("")}`);
      writeFileSync(file, text);
    }
    return ok();
  };
  return { runner, log };
}

const ctxFor = (runner: ReturnType<typeof polyglotMachine>["runner"]) =>
  ({ ...engineCtx(runner, tempPlatform("windows"), { exists: existsSync }), select: keepAll });

// ── Reading projects ────────────────────────────────────────

test("a folder is a Python, Go or Flutter project by its own files", () => {
  const py = tmp("dkit-py-");
  writeFileSync(path.join(py, "requirements.txt"), "# web\nFastAPI[standard]>=0.115\nSQLAlchemy==2.0.36\n-r dev.txt\n");
  assert.deepEqual(readProject(py), { dir: py, name: path.basename(py), ecosystem: "python", pm: "pip", pmReason: "requirements.txt, so pip in .venv", deps: { fastapi: "0.115", sqlalchemy: "2.0.36" } });

  const go = tmp("dkit-go-");
  writeFileSync(path.join(go, "go.mod"), "module api\n\ngo 1.27\n\nrequire (\n\tgithub.com/gin-gonic/gin v1.10.0\n\tgithub.com/jackc/pgx/v5 v5.7.1 // indirect\n)\n");
  assert.equal(readProject(go)?.ecosystem, "go");
  assert.deepEqual(readProject(go)?.deps, { "github.com/gin-gonic/gin": "1.10.0", "github.com/jackc/pgx/v5": "5.7.1" });

  assert.deepEqual(parsePubspec("name: app\ndependencies:\n  flutter:\n    sdk: flutter\n  get_it: ^8.0.2\ndev_dependencies:\n  mocktail: 1.0.4\n").deps, { flutter: "*", get_it: "8.0.2", mocktail: "1.0.4" });
  assert.deepEqual(parseGoMod("module x\nrequire github.com/redis/go-redis/v9 v9.7.0\n").deps, { "github.com/redis/go-redis/v9": "9.7.0" });
  assert.deepEqual(parseRequirements("psycopg[binary]\n"), { psycopg: "*" });
  assert.throws(() => readProject(go, { pm: "pnpm" }), /Go project, so --pm doesn't apply/);
});

test("Python libraries are found by pip's names: psycopg[binary] is psycopg", () => {
  const dir = tmp("dkit-py-");
  writeFileSync(path.join(dir, "requirements.txt"), "psycopg==3.2.3\nfastapi[standard]\n");
  const project = readProject(dir)!;
  assert.equal(detectInProject(getItem("psycopg")!, project).installed, true);
  assert.equal(detectInProject(getItem("psycopg")!, project).version, "3.2.3");
  assert.equal(detectInProject(getItem("fastapi")!, project).installed, true);
  assert.equal(detectInProject(getItem("hono")!, project).installed, false, "a JavaScript library is never 'in' a Python project");
});

test("add commands: pip in the project's .venv, go get, flutter pub add", () => {
  assert.deepEqual(addCommand("pip", ["fastapi[standard]"], false, { dir: "C:\\api", os: "windows" }),
    { command: "C:\\api\\.venv\\Scripts\\python.exe", args: ["-m", "pip", "install", "fastapi[standard]"] });
  assert.deepEqual(addCommand("pip", ["sqlalchemy"], false, { dir: "/home/me/api", os: "linux" }).command, "/home/me/api/.venv/bin/python");
  assert.deepEqual(addCommand("go", ["github.com/gin-gonic/gin"], false), { command: "go", args: ["get", "github.com/gin-gonic/gin"] });
  assert.deepEqual(addCommand("flutter", ["mocktail"], true), { command: "flutter", args: ["pub", "add", "dev:mocktail"] });
  assert.equal(dartName("My-App 2"), "my_app_2");
  assert.equal(dartName("2fast"), "app_2fast");
});

test("a library for another kind of project is left out with a reason, not installed", () => {
  const dir = tmp("dkit-node-");
  writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "web" }));
  const { runner } = polyglotMachine();
  const plan = buildPlan(["gin", "hono"], { runner, platform: tempPlatform("windows"), project: readProject(dir)!, exists: () => false });
  assert.deepEqual(plan.wrongProject.map((i) => i.id), ["gin"]);
  assert.deepEqual(plan.projectAdd.map((i) => i.id), ["hono"]);
});

// ── Stacks ──────────────────────────────────────────────────

test("a stack can't mix JavaScript and Python, and --pm only fits JavaScript stacks", async () => {
  assert.throws(() => validateRecipe({ id: "mix", name: "Mix", machine: [], libraries: ["hono", "fastapi"] }), /mixes JavaScript and Python/);
  assert.throws(() => validateRecipe({ id: "mix", name: "Mix", starter: "next", machine: [], libraries: ["gin"] }), /mixes Go and JavaScript|mixes JavaScript and Go/);
  assert.throws(() => validateRecipe({ id: "py", name: "Py", starter: "fastapi", machine: [], libraries: ["sqlalchemy"], pm: "pnpm" }), /only applies to JavaScript/);
  const { runner } = polyglotMachine();
  await assert.rejects(
    installStack(findRecipe("gin-redis", tempPlatform("windows")), ctxFor(runner), { projectDir: path.join(tmp("dkit-p-"), "api"), explicitProject: true, pm: "npm" }),
    /Go project, so --pm doesn't apply/,
  );
});

test("FastAPI stack: a .venv, main.py, then pip installs into the .venv and requirements.txt records it", async () => {
  const parent = tmp("dkit-parent-");
  const dir = path.join(parent, "api");
  const { runner, log } = polyglotMachine();
  const report = await installStack(findRecipe("fastapi-sqlalchemy", tempPlatform("windows")), ctxFor(runner), { projectDir: dir, explicitProject: true });

  assert.deepEqual(log.map((l) => [l.line, l.cwd]), [
    ["python -m venv .venv", dir],
    [`${path.join(dir, ".venv", "Scripts", "python.exe")} -m pip install fastapi[standard] sqlalchemy psycopg[binary]`, dir],
  ]);
  assert.match(readFileSync(path.join(dir, "main.py"), "utf8"), /app = FastAPI\(\)/);
  assert.deepEqual(readFileSync(path.join(dir, "requirements.txt"), "utf8").trim().split("\n"), ["fastapi[standard]", "sqlalchemy", "psycopg[binary]"]);
  assert.deepEqual(report?.results.filter((r) => r.outcome === "installed").map((r) => r.id).filter((id) => !["python", "postgresql"].includes(id)),
    ["starter:fastapi", "fastapi", "sqlalchemy", "psycopg"]);
});

test("Gin stack: go mod init, main.go, then go get for Gin, pgx and go-redis", async () => {
  const dir = path.join(tmp("dkit-parent-"), "Shop-API");
  const { runner, log } = polyglotMachine();
  const report = await installStack(findRecipe("gin-redis", tempPlatform("windows")), ctxFor(runner), { projectDir: dir, explicitProject: true });
  assert.deepEqual(log.map((l) => l.line), [
    "go mod init shop-api",
    "go get github.com/gin-gonic/gin github.com/jackc/pgx/v5 github.com/redis/go-redis/v9",
  ]);
  assert.match(readFileSync(path.join(dir, "main.go"), "utf8"), /gin\.Default\(\)/);
  assert.ok(["gin", "pgx", "go-redis"].every((id) => report?.results.some((r) => r.id === id && r.outcome === "installed")));
  assert.ok(!report?.results.some((r) => r.id === "redis" && r.outcome === "failed"), "Redis (Memurai) is found on Windows");
});

test("Flutter stack: flutter create with a valid Dart name, then flutter pub add", async () => {
  const parent = tmp("dkit-parent-");
  const dir = path.join(parent, "my-app");
  const { runner, log } = polyglotMachine();
  const report = await installStack(findRecipe("flutter-bloc", tempPlatform("windows")), ctxFor(runner), { projectDir: dir, explicitProject: true });
  assert.deepEqual(log.map((l) => [l.line, l.cwd]), [
    ["flutter create --project-name my_app my-app", parent],
    ["flutter pub add flutter_bloc get_it", dir],
  ]);
  assert.ok(["flutter-bloc", "get-it"].every((id) => report?.results.some((r) => r.id === id && r.outcome === "installed")));
});

test("new JavaScript starters: React + Vite and NestJS", async () => {
  const cases: [string, string, string][] = [
    ["react-hono", "pnpm", "npx --yes create-vite@latest web --template react-ts --no-interactive"],
    ["nest-prisma-redis", "yarn", "npx --yes @nestjs/cli@latest new web --package-manager yarn --skip-git"],
  ];
  for (const [id, pm, expected] of cases) {
    const parent = tmp("dkit-parent-");
    const { runner } = fakeRunner({ installed: new Set(["node", "pnpm", "yarn", "psql", "memurai", "winget"]) });
    const lines: string[] = [];
    const base = runner.run;
    runner.run = (cmd, args = [], o) => {
      if (cmd === "npx") {
        lines.push(`${cmd} ${args.join(" ")}`);
        mkdirSync(path.join(o!.cwd!, "web"), { recursive: true });
        writeFileSync(path.join(o!.cwd!, "web", "package.json"), JSON.stringify({ name: "web" }));
        return ok();
      }
      return base(cmd, args, o);
    };
    await installStack(findRecipe(id, tempPlatform("windows")), { ...engineCtx(runner, tempPlatform("windows")), select: keepAll },
      { projectDir: path.join(parent, "web"), explicitProject: true, pm: pm as "npm" });
    assert.equal(lines[0], expected, id);
  }
});
