import { appendFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { CatalogItem, Ecosystem } from "./catalog.js";
import type { ToolStatus } from "./detect.js";
import type { OS } from "./platform.js";
import type { Runner } from "../utils/run.js";
import { parseJson } from "../utils/json.js";

/** JavaScript package managers (the ones --pm accepts). */
export const PACKAGE_MANAGERS = ["npm", "pnpm", "yarn", "bun"] as const;
export type NodePackageManager = (typeof PACKAGE_MANAGERS)[number];
/** How libraries are added: a JavaScript package manager, or the tool of a Python, Go or Flutter project. */
export type PackageManager = NodePackageManager | "pip" | "go" | "flutter";
export const ALL_PACKAGE_MANAGERS: PackageManager[] = [...PACKAGE_MANAGERS, "pip", "go", "flutter"];

/** The one way each non-JavaScript project adds libraries. */
export const ECOSYSTEM_PM: Record<Exclude<Ecosystem, "node">, PackageManager> = { python: "pip", go: "go", flutter: "flutter" };
export const ECOSYSTEM_LABEL: Record<Ecosystem, string> = { node: "JavaScript", python: "Python", go: "Go", flutter: "Flutter" };
export const ecosystemOfPm = (pm: PackageManager): Ecosystem => (pm === "pip" ? "python" : pm === "go" ? "go" : pm === "flutter" ? "flutter" : "node");

/** A project dkit can add libraries to: a folder with package.json, requirements.txt/pyproject.toml, go.mod or pubspec.yaml. */
export interface ProjectInfo {
  dir: string;
  name?: string;
  ecosystem: Ecosystem;
  pm: PackageManager;
  /** How the package manager was chosen, shown in the plan. */
  pmReason: string;
  /** Every dependency (regular and dev) → its version or version range. Python names are normalized. */
  deps: Record<string, string>;
}

export interface ProjectDeps {
  exists?: (p: string) => boolean;
  readFile?: (p: string) => string;
}

// Checked in this order: a project with two lockfiles uses the first match.
const LOCKFILES: [string, NodePackageManager][] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

/** "Flask_Login[async]>=2.0" → "flask-login": how pip compares package names. */
export const pythonName = (spec: string) => (spec.trim().match(/^[A-Za-z0-9][A-Za-z0-9._-]*/)?.[0] ?? "").toLowerCase().replace(/[._]+/g, "-");

/** requirements.txt: one package per line; comments, options (-r, -e) and blank lines are skipped. */
export function parseRequirements(text: string): Record<string, string> {
  const deps: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line || line.startsWith("-")) continue;
    const name = pythonName(line);
    if (name) deps[name] = line.slice(line.search(/[<>=!~]/) >= 0 ? line.search(/[<>=!~]/) : line.length).replace(/^[<>=!~]+/, "") || "*";
  }
  return deps;
}

/** pyproject.toml: the names in `dependencies = [...]` under [project]. A light read, enough to tell what's there. */
export function parsePyproject(text: string): { name?: string; deps: Record<string, string> } {
  const name = text.match(/^\s*name\s*=\s*["']([^"']+)["']/m)?.[1];
  const block = text.match(/^\s*dependencies\s*=\s*\[([\s\S]*?)\]/m)?.[1] ?? "";
  const deps: Record<string, string> = {};
  for (const m of block.matchAll(/["']([^"']+)["']/g)) { const n = pythonName(m[1]); if (n) deps[n] = "*"; }
  return { name, deps };
}

/** go.mod: the module name and every `require` (single lines and blocks). */
export function parseGoMod(text: string): { name?: string; deps: Record<string, string> } {
  const name = text.match(/^module\s+(\S+)/m)?.[1];
  const deps: Record<string, string> = {};
  let inBlock = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (/^require\s*\($/.test(line)) { inBlock = true; continue; }
    if (inBlock && line === ")") { inBlock = false; continue; }
    const m = inBlock ? line.match(/^(\S+)\s+(\S+)/) : line.match(/^require\s+(\S+)\s+(\S+)/);
    if (m) deps[m[1]] = m[2].replace(/^v/, "");
  }
  return { name, deps };
}

/** pubspec.yaml: the package name and the top-level keys under dependencies / dev_dependencies. */
export function parsePubspec(text: string): { name?: string; deps: Record<string, string> } {
  const name = text.match(/^name:\s*(\S+)/m)?.[1];
  const deps: Record<string, string> = {};
  let section = "";
  for (const raw of text.split(/\r?\n/)) {
    if (/^\S/.test(raw)) { section = raw.replace(/:.*$/, "").trim(); continue; }
    if (section !== "dependencies" && section !== "dev_dependencies") continue;
    const m = raw.match(/^ {2}([A-Za-z0-9_]+):\s*(.*)$/);
    if (m) deps[m[1]] = m[2].replace(/^[\^~>=<\s]+/, "").replace(/["']/g, "") || "*";
  }
  return { name, deps };
}

/**
 * Read the project in `dir`, or null if it isn't one. Only `dir` itself is checked (not parent folders)
 * so dkit never edits a project you didn't point at. `pm` (from --pm) only applies to JavaScript projects.
 */
export function readProject(dir: string, opts: ProjectDeps & { pm?: PackageManager } = {}): ProjectInfo | null {
  const exists = opts.exists ?? existsSync;
  const read = opts.readFile ?? ((p: string) => readFileSync(p, "utf8"));
  const at = (f: string) => path.join(dir, f);
  const other = (ecosystem: Exclude<Ecosystem, "node">, pmReason: string, name: string | undefined, deps: Record<string, string>): ProjectInfo => {
    if (opts.pm && opts.pm !== ECOSYSTEM_PM[ecosystem]) throw new Error(`${dir} is a ${ECOSYSTEM_LABEL[ecosystem]} project, so --pm doesn't apply: libraries are added with ${ECOSYSTEM_PM[ecosystem]}.`);
    return { dir, name, ecosystem, pm: ECOSYSTEM_PM[ecosystem], pmReason, deps };
  };

  if (exists(at("package.json"))) {
    let pkg: { name?: string; packageManager?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    try {
      pkg = parseJson(read(at("package.json"))) as typeof pkg;
    } catch {
      throw new Error(`${at("package.json")} isn't valid JSON. Fix it first, then run dkit again.`);
    }
    if (opts.pm && !PACKAGE_MANAGERS.includes(opts.pm as NodePackageManager)) throw new Error(`${dir} is a JavaScript project: use --pm npm, pnpm, yarn or bun.`);
    let pm: PackageManager = "npm";
    let pmReason = "no lockfile, so npm";
    const declared = pkg.packageManager?.split("@")[0] as NodePackageManager | undefined;
    const lock = LOCKFILES.find(([f]) => exists(at(f)));
    if (opts.pm) [pm, pmReason] = [opts.pm, "chosen with --pm"];
    else if (declared && PACKAGE_MANAGERS.includes(declared)) [pm, pmReason] = [declared, `"packageManager" in package.json`];
    else if (lock) [pm, pmReason] = [lock[1], `found ${lock[0]}`];
    return { dir, name: pkg.name, ecosystem: "node", pm, pmReason, deps: { ...pkg.devDependencies, ...pkg.dependencies } };
  }
  if (exists(at("pubspec.yaml"))) {
    const p = parsePubspec(read(at("pubspec.yaml")));
    return other("flutter", "pubspec.yaml, so flutter pub", p.name, p.deps);
  }
  if (exists(at("go.mod"))) {
    const g = parseGoMod(read(at("go.mod")));
    return other("go", "go.mod, so go get", g.name, g.deps);
  }
  const hasReq = exists(at("requirements.txt"));
  const hasPy = exists(at("pyproject.toml"));
  if (hasReq || hasPy) {
    const py = hasPy ? parsePyproject(read(at("pyproject.toml"))) : { name: undefined, deps: {} };
    const req = hasReq ? parseRequirements(read(at("requirements.txt"))) : {};
    return other("python", `${hasReq ? "requirements.txt" : "pyproject.toml"}, so pip in .venv`, py.name ?? path.basename(dir), { ...py.deps, ...req });
  }
  return null;
}

/** Machine tools a package manager needs. Bun runs on its own; the other JavaScript ones need Node.js. */
export function pmRequires(pm: PackageManager): string[] {
  switch (pm) {
    case "npm": return ["node"];
    case "bun": return ["bun"];
    case "pip": return ["python"];
    case "go": return ["go"];
    case "flutter": return ["flutter"];
    default: return ["node", pm];
  }
}

/** The system Python: `python` on Windows, `python3` on macOS and Linux. */
export const pythonCommand = (os: OS) => (os === "windows" ? "python" : "python3");
/** The project's own Python, inside .venv. */
export const venvPython = (dir: string, os: OS) =>
  os === "windows" ? path.win32.join(dir, ".venv", "Scripts", "python.exe") : path.posix.join(dir, ".venv", "bin", "python");

/**
 * The command that adds packages, e.g. `pnpm add -D drizzle-kit`, `go get github.com/gin-gonic/gin`,
 * `flutter pub add dev:mocktail`, or the project's .venv Python running `pip install`.
 */
export function addCommand(pm: PackageManager, packages: string[], dev: boolean, at: { dir: string; os: OS } = { dir: ".", os: "linux" }): { command: string; args: string[] } {
  switch (pm) {
    case "pip": return { command: venvPython(at.dir, at.os), args: ["-m", "pip", "install", ...packages] };
    case "go": return { command: "go", args: ["get", ...packages] };
    case "flutter": return { command: "flutter", args: ["pub", "add", ...packages.map((p) => (dev ? `dev:${p}` : p))] };
    default: {
      const verb = pm === "npm" ? "install" : "add";
      const devFlag = pm === "bun" ? "-d" : "-D";
      return { command: pm, args: [verb, ...(dev ? [devFlag] : []), ...packages] };
    }
  }
}

export const describeAdd = (pm: PackageManager, packages: string[], dev: boolean) => {
  if (pm === "pip") return `pip install ${packages.join(" ")}  (into .venv, recorded in requirements.txt)`;
  const { command, args } = addCommand(pm, packages, dev);
  return [command, ...args].join(" ");
};

/** Python projects: make the .venv if there isn't one yet. Returns an error message, or null. */
export function ensureVenv(dir: string, os: OS, runner: Runner, exists: (p: string) => boolean = existsSync): string | null {
  if (exists(venvPython(dir, os))) return null;
  const r = runner.run(pythonCommand(os), ["-m", "venv", ".venv"], { inherit: true, cwd: dir });
  return r.ok ? null : `Couldn't create the virtual environment (.venv) with ${pythonCommand(os)} -m venv: ${r.error ?? `exit code ${r.code}`}`;
}

/** Python projects: add what pip just installed to requirements.txt (pip doesn't), once each. */
export function recordRequirements(dir: string, packages: string[]) {
  const file = path.join(dir, "requirements.txt");
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const have = new Set(Object.keys(parseRequirements(text)));
  const add = packages.filter((p) => !have.has(pythonName(p)));
  if (add.length) appendFileSync(file, (text && !text.endsWith("\n") ? "\n" : "") + add.join("\n") + "\n");
}

/** e.g. "adds drizzle-orm, dev: drizzle-kit" */
export function describePackages(item: CatalogItem): string {
  const deps = item.packages?.deps ?? [];
  const dev = item.packages?.dev ?? [];
  const eco = item.packages?.ecosystem;
  return `${eco && eco !== "node" ? `${ECOSYSTEM_LABEL[eco]}: ` : ""}adds ${[...deps, ...(dev.length ? [`dev: ${dev.join(", ")}`] : [])].join(", ")}`;
}

/** Everything a project resource adds. */
export function allPackages(item: CatalogItem): string[] {
  return [...(item.packages?.deps ?? []), ...(item.packages?.dev ?? [])];
}

/** Which kind of project a library belongs in. */
export const itemEcosystem = (item: CatalogItem): Ecosystem => item.packages?.ecosystem ?? "node";

/** The name a package is listed under in the project's files (Python: normalized, without extras). */
const depKey = (pkg: string, eco: Ecosystem) => (eco === "python" ? pythonName(pkg) : pkg);

/** A project resource counts as installed when every one of its packages is in the project. */
export function detectInProject(item: CatalogItem, project: ProjectInfo): ToolStatus {
  const keys = itemEcosystem(item) === project.ecosystem ? allPackages(item).map((p) => depKey(p, project.ecosystem)) : [];
  const installed = keys.length > 0 && keys.every((k) => k in project.deps);
  const first = keys[0] ? project.deps[keys[0]] : undefined;
  return {
    id: item.id,
    name: item.name,
    installed,
    version: installed && first && first !== "*" ? first.replace(/^[\^~>=<\s]+/, "") : undefined,
    where: installed ? project.dir : undefined,
  };
}
