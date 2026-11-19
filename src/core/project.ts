import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { CatalogItem } from "./catalog.js";
import type { ToolStatus } from "./detect.js";

export const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

/** A JavaScript/TypeScript project: a folder with a package.json. */
export interface ProjectInfo {
  dir: string;
  name?: string;
  pm: PackageManager;
  /** How the package manager was chosen, shown in the plan. */
  pmReason: string;
  /** Every dependency (regular and dev) → the version range in package.json. */
  deps: Record<string, string>;
}

export interface ProjectDeps {
  exists?: (p: string) => boolean;
  readFile?: (p: string) => string;
}

// Checked in this order: a project with two lockfiles uses the first match.
const LOCKFILES: [string, PackageManager][] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

/**
 * Read the project in `dir`, or null if there's no package.json there.
 * Only `dir` itself is checked (not parent folders) so dkit never edits a project you didn't point at.
 */
export function readProject(dir: string, opts: ProjectDeps & { pm?: PackageManager } = {}): ProjectInfo | null {
  const exists = opts.exists ?? existsSync;
  const read = opts.readFile ?? ((p: string) => readFileSync(p, "utf8"));
  const pkgPath = path.join(dir, "package.json");
  if (!exists(pkgPath)) return null;

  let pkg: { name?: string; packageManager?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkg = JSON.parse(read(pkgPath));
  } catch {
    throw new Error(`${pkgPath} isn't valid JSON. Fix it first, then run dkit again.`);
  }

  let pm: PackageManager = "npm";
  let pmReason = "no lockfile, so npm";
  const declared = pkg.packageManager?.split("@")[0] as PackageManager | undefined;
  const lock = LOCKFILES.find(([f]) => exists(path.join(dir, f)));
  if (opts.pm) [pm, pmReason] = [opts.pm, "chosen with --pm"];
  else if (declared && PACKAGE_MANAGERS.includes(declared)) [pm, pmReason] = [declared, `"packageManager" in package.json`];
  else if (lock) [pm, pmReason] = [lock[1], `found ${lock[0]}`];

  return { dir, name: pkg.name, pm, pmReason, deps: { ...pkg.devDependencies, ...pkg.dependencies } };
}

/** Machine tools a package manager needs. Bun runs on its own; the others need Node.js. */
export function pmRequires(pm: PackageManager): string[] {
  return pm === "npm" ? ["node"] : pm === "bun" ? ["bun"] : ["node", pm];
}

/** The command that adds packages, e.g. `pnpm add -D drizzle-kit`. */
export function addCommand(pm: PackageManager, packages: string[], dev: boolean): { command: string; args: string[] } {
  const verb = pm === "npm" ? "install" : "add";
  const devFlag = pm === "bun" ? "-d" : "-D";
  return { command: pm, args: [verb, ...(dev ? [devFlag] : []), ...packages] };
}

export const describeAdd = (pm: PackageManager, packages: string[], dev: boolean) => {
  const { command, args } = addCommand(pm, packages, dev);
  return [command, ...args].join(" ");
};

/** e.g. "adds drizzle-orm, dev: drizzle-kit" */
export function describePackages(item: CatalogItem): string {
  const deps = item.packages?.deps ?? [];
  const dev = item.packages?.dev ?? [];
  return `adds ${[...deps, ...(dev.length ? [`dev: ${dev.join(", ")}`] : [])].join(", ")}`;
}

/** Everything a project resource adds. */
export function allPackages(item: CatalogItem): string[] {
  return [...(item.packages?.deps ?? []), ...(item.packages?.dev ?? [])];
}

/** A project resource counts as installed when every one of its packages is in package.json. */
export function detectInProject(item: CatalogItem, project: ProjectInfo): ToolStatus {
  const pkgs = allPackages(item);
  const installed = pkgs.length > 0 && pkgs.every((p) => p in project.deps);
  const first = pkgs[0] ? project.deps[pkgs[0]] : undefined;
  return {
    id: item.id,
    name: item.name,
    installed,
    version: installed ? first?.replace(/^[\^~>=<\s]+/, "") : undefined,
    where: installed ? path.join(project.dir, "package.json") : undefined,
  };
}
