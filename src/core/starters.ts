import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import type { Runner } from "../utils/run.js";
import type { PackageManager } from "./project.js";

/**
 * Creates a new project with a framework's own official starter, run without prompts.
 * dkit keeps no templates of its own: the frameworks keep their starters up to date.
 */
export interface Starter {
  id: string;
  name: string;
  description: string;
  /** The commands, in order. The first runs in the parent folder, the rest inside the new project. */
  steps: (pm: PackageManager, name: string) => StarterStep[];
  notes?: string[];
}

export interface StarterStep {
  command: string;
  args: string[];
  /** Run inside the new project folder (after it exists) instead of its parent. */
  inProject?: boolean;
  /** Create the project folder first (for starters that fill an existing folder). */
  mkdir?: boolean;
}

/** Run a package from the registry without installing it: npx for npm/pnpm/yarn projects, bunx for Bun. */
const runPkg = (pm: PackageManager, pkg: string, args: string[]): StarterStep =>
  pm === "bun" ? { command: "bunx", args: [pkg, ...args] } : { command: "npx", args: ["--yes", pkg, ...args] };

const installStep = (pm: PackageManager): StarterStep => ({ command: pm, args: ["install"], inProject: true });

export const STARTERS: Starter[] = [
  {
    id: "next",
    name: "Next.js",
    description: "React framework (create-next-app with its defaults: TypeScript, App Router, ESLint, Tailwind)",
    steps: (pm, name) => [runPkg(pm, "create-next-app@latest", [name, "--yes", `--use-${pm}`])],
    notes: ["Start it with `npm run dev` (or your package manager's `dev`)."],
  },
  {
    id: "solid",
    name: "SolidJS",
    description: "SolidJS + Vite + TypeScript (create-solid, bare template)",
    steps: (pm, name) => [runPkg(pm, "create-solid@latest", [name, "--vanilla", "--ts", "--template", "bare"]), installStep(pm)],
    notes: ["Start it with `npm run dev` (or your package manager's `dev`)."],
  },
  {
    id: "hono",
    name: "Hono",
    description: "Hono API server (create-hono, Node.js template; Bun template for Bun projects)",
    steps: (pm, name) => [
      runPkg(pm, "create-hono@latest", [name, "--template", pm === "bun" ? "bun" : "nodejs", "--pm", pm, "--install"]),
    ],
    notes: ["Start it with `npm run dev` (or your package manager's `dev`)."],
  },
  {
    id: "node",
    name: "empty Node.js",
    description: "Just a package.json, from your package manager's own init",
    steps: (pm) => [
      { command: pm, args: pm === "pnpm" ? ["init"] : ["init", "-y"], mkdir: true, inProject: true },
    ],
  },
];

export function getStarter(id: string): Starter | undefined {
  return STARTERS.find((s) => s.id === id);
}

/** Machine tools a starter needs: Node.js for npx, or Bun for bunx. */
export const starterRequires = (pm: PackageManager) => (pm === "bun" ? ["bun"] : ["node"]);

/** A new project may only go into a folder that doesn't exist yet or is empty. */
export function checkNewProjectDir(dir: string): string | null {
  if (!existsSync(path.dirname(dir))) return `The parent folder ${path.dirname(dir)} doesn't exist.`;
  if (existsSync(dir) && readdirSync(dir).length) return `${dir} already has files in it. Pick a new folder name, or run this inside an existing project to add the stack to it.`;
  return null;
}

export const describeSteps = (starter: Starter, pm: PackageManager, name: string) =>
  starter.steps(pm, name).map((s) => [s.command, ...s.args].join(" "));

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

/** Run a starter. Returns an error message, or null when the project folder has a package.json. */
export function runStarter(starter: Starter, pm: PackageManager, dir: string, runner: Runner): string | null {
  const parent = path.dirname(dir);
  const name = path.basename(dir);
  for (const step of starter.steps(pm, name)) {
    if (step.mkdir) mkdirSync(dir, { recursive: true });
    const r = runner.run(step.command, step.args, { inherit: true, cwd: step.inProject ? dir : parent });
    if (!r.ok) return `\`${[step.command, ...step.args].join(" ")}\` failed${r.code !== null ? ` (exit code ${r.code})` : `: ${r.error}`}`;
    removeOtherLockfiles(dir, pm);
  }
  if (!existsSync(path.join(dir, "package.json"))) return `${starter.name} finished, but ${dir} has no package.json.`;
  return null;
}
