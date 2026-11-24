import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Runner } from "../utils/run.js";
import type { Ecosystem } from "./catalog.js";
import type { OS } from "./platform.js";
import { ECOSYSTEM_LABEL, pythonCommand, readProject, type PackageManager } from "./project.js";

/**
 * Creates a new project with a framework's own official starter, run without prompts.
 * dkit keeps no templates of its own: the frameworks keep their starters up to date. The only
 * exceptions are FastAPI and Gin, which have no official generator: for them dkit writes the same
 * minimal hello-world file their tutorials start with.
 */
export interface Starter {
  id: string;
  name: string;
  description: string;
  /** What kind of project it creates (and so how libraries are added afterwards). */
  ecosystem: Ecosystem;
  /** The commands, in order. Steps run in the parent folder unless `inProject` is set. */
  steps: (pm: PackageManager, name: string, os: OS) => StarterStep[];
  notes?: string[];
}

export interface StarterStep {
  command: string;
  args: string[];
  /** Run inside the new project folder (after it exists) instead of its parent. */
  inProject?: boolean;
  /** Create the project folder first (for starters that fill an existing folder). */
  mkdir?: boolean;
  /** Instead of running a command, write this fixed file into the project. */
  write?: { file: string; content: string };
}

/** Run a package from the registry without installing it: npx for npm/pnpm/yarn projects, bunx for Bun. */
const runPkg = (pm: PackageManager, pkg: string, args: string[]): StarterStep =>
  pm === "bun" ? { command: "bunx", args: [pkg, ...args] } : { command: "npx", args: ["--yes", pkg, ...args] };

const installStep = (pm: PackageManager): StarterStep => ({ command: pm, args: ["install"], inProject: true });

const writeStep = (file: string, content: string): StarterStep => ({ command: "", args: [], write: { file, content } });

const startNote = "Start it with `npm run dev` (or your package manager's `dev`).";

const FASTAPI_MAIN = `from fastapi import FastAPI

app = FastAPI()


@app.get("/")
def read_root():
    return {"message": "Hello from FastAPI"}
`;

const GIN_MAIN = `package main

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func main() {
	r := gin.Default()
	r.GET("/", func(c *gin.Context) {
		c.JSON(http.StatusOK, gin.H{"message": "Hello from Gin"})
	})
	r.Run(":8080")
}
`;

/** Dart package names are lowercase_with_underscores: "my-app" → "my_app". */
export const dartName = (name: string) => {
  const n = name.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[a-z]/.test(n) ? n : `app_${n || "1"}`;
};

export const STARTERS: Starter[] = [
  {
    id: "next",
    name: "Next.js",
    description: "React framework (create-next-app with its defaults: TypeScript, App Router, ESLint, Tailwind)",
    ecosystem: "node",
    steps: (pm, name) => [runPkg(pm, "create-next-app@latest", [name, "--yes", `--use-${pm}`])],
    notes: [startNote],
  },
  {
    id: "solid",
    name: "SolidJS",
    description: "SolidJS + Vite + TypeScript (create-solid, bare template)",
    ecosystem: "node",
    steps: (pm, name) => [runPkg(pm, "create-solid@latest", [name, "--vanilla", "--ts", "--template", "bare"]), installStep(pm)],
    notes: [startNote],
  },
  {
    id: "vite-react",
    name: "React + Vite",
    description: "React + TypeScript on Vite (create-vite, react-ts template)",
    ecosystem: "node",
    steps: (pm, name) => [runPkg(pm, "create-vite@latest", [name, "--template", "react-ts", "--no-interactive"]), installStep(pm)],
    notes: [startNote],
  },
  {
    id: "hono",
    name: "Hono",
    description: "Hono API server (create-hono, Node.js template; Bun template for Bun projects)",
    ecosystem: "node",
    steps: (pm, name) => [
      runPkg(pm, "create-hono@latest", [name, "--template", pm === "bun" ? "bun" : "nodejs", "--pm", pm, "--install"]),
    ],
    notes: [startNote],
  },
  {
    id: "nest",
    name: "NestJS",
    description: "NestJS backend with TypeScript (the official Nest CLI: nest new)",
    ecosystem: "node",
    // The Nest CLI supports npm, yarn and pnpm; Bun projects are created with npm.
    steps: (pm, name) => [runPkg(pm, "@nestjs/cli@latest", ["new", name, "--package-manager", pm === "bun" ? "npm" : pm, "--skip-git"])],
    notes: ["Start it with `npm run start:dev` (or your package manager's `start:dev`)."],
  },
  {
    id: "node",
    name: "empty Node.js",
    description: "Just a package.json, from your package manager's own init",
    ecosystem: "node",
    steps: (pm) => [
      { command: pm, args: pm === "pnpm" ? ["init"] : ["init", "-y"], mkdir: true, inProject: true },
    ],
  },
  {
    id: "fastapi",
    name: "FastAPI",
    description: "Python API: a .venv, requirements.txt and FastAPI's hello-world main.py",
    ecosystem: "python",
    steps: (_pm, _name, os) => [
      { command: pythonCommand(os), args: ["-m", "venv", ".venv"], mkdir: true, inProject: true },
      writeStep("requirements.txt", ""),
      writeStep("main.py", FASTAPI_MAIN),
    ],
    notes: ["Activate the environment (.venv\\Scripts\\activate on Windows, source .venv/bin/activate elsewhere), then `fastapi dev main.py`."],
  },
  {
    id: "gin",
    name: "Gin",
    description: "Go API: a Go module (go mod init) with Gin's hello-world main.go",
    ecosystem: "go",
    steps: (_pm, name) => [
      { command: "go", args: ["mod", "init", name.toLowerCase()], mkdir: true, inProject: true },
      writeStep("main.go", GIN_MAIN),
    ],
    notes: ["Start it with `go run .` and open http://localhost:8080"],
  },
  {
    id: "flutter",
    name: "Flutter",
    description: "Flutter app for mobile, desktop and web (flutter create)",
    ecosystem: "flutter",
    steps: (_pm, name) => [{ command: "flutter", args: ["create", "--project-name", dartName(name), name] }],
    notes: ["Run it with `flutter run`. `flutter doctor` shows what your devices need."],
  },
];

export function getStarter(id: string): Starter | undefined {
  return STARTERS.find((s) => s.id === id);
}

/** Machine tools a starter needs: Node.js for npx (Bun for bunx), or Python, Go or Flutter. */
export const starterRequires = (pm: PackageManager) =>
  pm === "bun" ? ["bun"] : pm === "pip" ? ["python"] : pm === "go" ? ["go"] : pm === "flutter" ? ["flutter"] : ["node"];

/** A new project may only go into a folder that doesn't exist yet or is empty. */
export function checkNewProjectDir(dir: string): string | null {
  if (!existsSync(path.dirname(dir))) return `The parent folder ${path.dirname(dir)} doesn't exist.`;
  if (existsSync(dir) && readdirSync(dir).length) return `${dir} already has files in it. Pick a new folder name, or run this inside an existing project to add the stack to it.`;
  return null;
}

export const describeSteps = (starter: Starter, pm: PackageManager, name: string, os: OS = "linux") =>
  starter.steps(pm, name, os).map((s) => (s.write ? `writes ${s.write.file}` : [s.command, ...s.args].join(" ")));

const LOCKFILE_PM: Record<string, PackageManager> = {
  "package-lock.json": "npm", "pnpm-lock.yaml": "pnpm", "yarn.lock": "yarn", "bun.lock": "bun", "bun.lockb": "bun",
};

/**
 * Some templates ship another package manager's lockfile (create-solid includes pnpm-lock.yaml).
 * Left in place, it would make the project look like a pnpm project to every tool, dkit included.
 */
function removeOtherLockfiles(dir: string, pm: PackageManager) {
  for (const [file, owner] of Object.entries(LOCKFILE_PM)) {
    if (owner !== pm && existsSync(path.join(dir, file))) rmSync(path.join(dir, file));
  }
}

const MARKER: Record<Ecosystem, string> = { node: "package.json", python: "requirements.txt", go: "go.mod", flutter: "pubspec.yaml" };

/** Run a starter. Returns an error message, or null when the folder is now a project of the right kind. */
export function runStarter(starter: Starter, pm: PackageManager, dir: string, runner: Runner, os: OS = "linux"): string | null {
  const parent = path.dirname(dir);
  const name = path.basename(dir);
  for (const step of starter.steps(pm, name, os)) {
    if (step.mkdir) mkdirSync(dir, { recursive: true });
    if (step.write) {
      // Never overwrite something the framework's own tool made.
      const target = path.join(dir, step.write.file);
      if (!existsSync(target)) writeFileSync(target, step.write.content);
      continue;
    }
    const r = runner.run(step.command, step.args, { inherit: true, cwd: step.inProject ? dir : parent });
    if (!r.ok) return `\`${[step.command, ...step.args].join(" ")}\` failed${r.code !== null ? ` (exit code ${r.code})` : `: ${r.error}`}`;
    if (starter.ecosystem === "node") removeOtherLockfiles(dir, pm);
  }
  let project = null;
  try { project = readProject(dir); } catch { /* a broken package.json counts as not created */ }
  if (project?.ecosystem !== starter.ecosystem) return `${starter.name} finished, but ${dir} isn't a ${ECOSYSTEM_LABEL[starter.ecosystem]} project (no ${MARKER[starter.ecosystem]}).`;
  return null;
}
