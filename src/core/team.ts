import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Runner } from "../utils/run.js";
import type { PlatformInfo } from "./platform.js";
import { validateRecipe, type LoadedRecipe, type Recipe } from "./stack.js";
import { validateManifest, type Manifest } from "../manifest/manifest.js";

/**
 * Team-shared setups: a Git repository with
 *   dkit-team.json   {"format": "dkit-team", "version": 1, "name": "Acme web team", "description": "..."}
 *   baseline.json    optional manifest (`dkit scan -o baseline.json`): what everyone on the team should have
 *   stacks/*.json    stack recipes (`dkit stack save`)
 * Each person connects once with `dkit team add <url>`; dkit keeps a clone in ~/.dkit/teams/<name>.
 * Everything in it is checked as strictly as a file from a stranger: recipes and manifests only
 * reference catalog ids, so a team repo can't make dkit run anything that isn't in the catalog.
 */

export const TEAM_FILE = "dkit-team.json";
export const BASELINE_FILE = "baseline.json";
export const STACKS_FOLDER = "stacks";

const NAME = /^[a-z0-9][a-z0-9-]{0,49}$/;

export interface TeamInfo {
  name: string;
  description: string;
}

export interface Team extends TeamInfo {
  /** Folder name under ~/.dkit/teams, used on the command line: `dkit team status acme`. */
  id: string;
  dir: string;
  stacks: LoadedRecipe[];
  /** Path to baseline.json, if the team has one. */
  baseline?: string;
  /** Files dkit refused to use, with the reason. */
  problems: string[];
}

export const teamsDir = (platform: PlatformInfo) => path.join(platform.home, ".dkit", "teams");

/** Only Git URLs (https, ssh, git@host:path) and existing local folders. Never `-option` or `ext::` transports. */
export function checkTeamUrl(url: string): string {
  const u = url.trim();
  if (!u || u.startsWith("-")) throw new Error(`"${url}" isn't a Git repository URL.`);
  if (/^https:\/\/\S+$/i.test(u) || /^ssh:\/\/\S+$/i.test(u) || /^[\w.-]+@[\w.-]+:[\w./~-]+$/.test(u)) return u;
  if (/^http:\/\//i.test(u)) throw new Error(`Use https:// instead of http:// (${u}).`);
  if (!u.includes("::") && existsSync(u)) return path.resolve(u);
  throw new Error(`"${url}" isn't a Git repository URL. Use https://..., git@host:org/repo.git, or a local folder.`);
}

/** "https://github.com/acme/dev-setup.git" → "dev-setup". */
export function teamIdFromUrl(url: string): string {
  const base = url.replace(/[\\/]+$/, "").split(/[\\/:]/).pop()!.replace(/\.git$/i, "");
  return base.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "team";
}

export function validateTeamFile(data: unknown, where = TEAM_FILE): TeamInfo {
  const fail = (msg: string): never => { throw new Error(`${where}: ${msg}`); };
  if (!data || typeof data !== "object" || Array.isArray(data)) fail("not a team file");
  const t = data as Record<string, unknown>;
  const extra = Object.keys(t).filter((k) => !["format", "version", "name", "description"].includes(k));
  if (extra.length) fail(`unknown field(s) ${extra.join(", ")}`);
  if (t.format !== "dkit-team") fail(`format must be "dkit-team"`);
  if (t.version !== 1) fail(`unsupported version ${String(t.version)}. Update dkit.`);
  if (typeof t.name !== "string" || !t.name.trim()) fail("name is required");
  if (t.description !== undefined && typeof t.description !== "string") fail("description must be text");
  return { name: (t.name as string).trim(), description: (t.description as string | undefined) ?? "" };
}

/** A regular file inside the repo (symlinks are refused, so a repo can't point dkit at your own files). */
function readRepoFile(file: string): string | null {
  if (!existsSync(file) || !lstatSync(file).isFile()) return null;
  return readFileSync(file, "utf8");
}

function parse(text: string, where: string): unknown {
  try { return JSON.parse(text); } catch { throw new Error(`${where} isn't valid JSON.`); }
}

/** Read a team folder (a clone, or the folder `dkit team init` made). Throws if it isn't a team repo. */
export function readTeam(dir: string, id = path.basename(dir)): Team {
  const teamText = readRepoFile(path.join(dir, TEAM_FILE));
  if (teamText === null) throw new Error(`${dir} isn't a dkit team repository: it has no ${TEAM_FILE}. Create one with \`dkit team init\`.`);
  const info = validateTeamFile(parse(teamText, TEAM_FILE));
  const team: Team = { ...info, id, dir, stacks: [], problems: [] };

  const stacksDir = path.join(dir, STACKS_FOLDER);
  if (existsSync(stacksDir)) {
    for (const f of readdirSync(stacksDir).filter((f) => f.endsWith(".json")).sort()) {
      const where = `${STACKS_FOLDER}/${f}`;
      try {
        const text = readRepoFile(path.join(stacksDir, f));
        if (text === null) throw new Error(`${where}: not a regular file`);
        const r = validateRecipe(parse(text, where), where);
        if (team.stacks.some((s) => s.id === r.id)) throw new Error(`${where}: another stack already uses the id "${r.id}"`);
        team.stacks.push({ ...r, source: "team", team: id, path: path.join(stacksDir, f) });
      } catch (e) {
        team.problems.push(e instanceof Error ? e.message : String(e));
      }
    }
  }

  const baselineText = readRepoFile(path.join(dir, BASELINE_FILE));
  if (baselineText !== null) {
    try {
      validateManifest(parse(baselineText, BASELINE_FILE), BASELINE_FILE);
      team.baseline = path.join(dir, BASELINE_FILE);
    } catch (e) {
      team.problems.push(e instanceof Error ? e.message : String(e));
    }
  }
  return team;
}

export function listTeams(platform: PlatformInfo): { teams: Team[]; problems: string[] } {
  const dir = teamsDir(platform);
  const teams: Team[] = [];
  const problems: string[] = [];
  if (!existsSync(dir)) return { teams, problems };
  for (const id of readdirSync(dir).sort()) {
    if (!NAME.test(id) || !lstatSync(path.join(dir, id)).isDirectory()) continue;
    try { teams.push(readTeam(path.join(dir, id), id)); } catch (e) { problems.push(`${id}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return { teams, problems };
}

/** The named team, or the only one when no name is given. */
export function findTeam(platform: PlatformInfo, id?: string): Team {
  const { teams } = listTeams(platform);
  if (!teams.length) throw new Error("You haven't added a team yet. Add one with: dkit team add <git-url>");
  if (!id) {
    if (teams.length === 1) return teams[0];
    throw new Error(`You have ${teams.length} teams (${teams.map((t) => t.id).join(", ")}). Say which one, e.g. dkit team status ${teams[0].id}`);
  }
  const t = teams.find((t) => t.id === id.toLowerCase());
  if (!t) throw new Error(`No team "${id}". Your teams: ${teams.map((t) => t.id).join(", ")}`);
  return t;
}

// ── Git ──────────────────────────────────────────────────────

/** Symlinks are checked out as plain files; the `ext::` transport (runs a command) is never allowed. */
const SAFE_GIT = ["-c", "core.symlinks=false", "-c", "protocol.ext.allow=never"];

function needGit(runner: Runner) {
  if (!runner.which("git")) throw new Error("Team setups are Git repositories, so dkit needs Git. Install it with: dkit install git");
}

export function addTeam(url: string, deps: { runner: Runner; platform: PlatformInfo }, id?: string): Team {
  const { runner, platform } = deps;
  needGit(runner);
  const source = checkTeamUrl(url);
  const name = (id ?? teamIdFromUrl(source)).toLowerCase();
  if (!NAME.test(name)) throw new Error(`"${name}" can't be a team name: use lowercase letters, digits and dashes (--name acme).`);
  const target = path.join(teamsDir(platform), name);
  if (existsSync(target)) throw new Error(`You already have a team called "${name}". Update it with \`dkit team update ${name}\`, or pick another name with --name.`);

  mkdirSync(teamsDir(platform), { recursive: true });
  const r = runner.run("git", [...SAFE_GIT, "clone", "--depth", "1", "--quiet", "--", source, target]);
  if (!r.ok) {
    rmSync(target, { recursive: true, force: true });
    throw new Error(`Couldn't download ${source}: ${(r.stderr || r.stdout).trim() || "git clone failed"}.\nFor a private repository, check that \`git clone ${source}\` works for you.`);
  }
  try {
    return readTeam(target, name);
  } catch (e) {
    rmSync(target, { recursive: true, force: true }); // not a team repo: don't leave it behind
    throw e;
  }
}

export interface UpdateResult { team: string; ok: boolean; changed: boolean; message?: string }

export function updateTeam(team: Team, runner: Runner): UpdateResult {
  needGit(runner);
  const head = () => runner.run("git", ["-C", team.dir, "rev-parse", "HEAD"]).stdout.trim();
  const before = head();
  const r = runner.run("git", [...SAFE_GIT, "-C", team.dir, "pull", "--ff-only", "--quiet"]);
  if (!r.ok) return { team: team.id, ok: false, changed: false, message: (r.stderr || r.stdout).trim() || "git pull failed" };
  return { team: team.id, ok: true, changed: head() !== before };
}

export function removeTeam(team: Team) {
  rmSync(team.dir, { recursive: true, force: true });
}

// ── Starting a team repository ───────────────────────────────

export interface InitOptions {
  name: string;
  description?: string;
  baseline?: Manifest;
  stacks?: Recipe[];
  force?: boolean;
}

/** Write the files of a new team repository into `dir`. Returns the files written. */
export function initTeam(dir: string, opts: InitOptions): string[] {
  const teamFile = path.join(dir, TEAM_FILE);
  if (existsSync(teamFile) && !opts.force) throw new Error(`${teamFile} already exists. Use --force to replace it.`);
  const written: string[] = [];
  const write = (file: string, data: unknown) => {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
    written.push(file);
  };
  const info: Record<string, unknown> = { format: "dkit-team", version: 1, name: opts.name };
  if (opts.description) info.description = opts.description;
  write(teamFile, info);
  if (opts.baseline) write(path.join(dir, BASELINE_FILE), opts.baseline);
  for (const r of opts.stacks ?? []) {
    const out: Record<string, unknown> = { format: "dkit-stack", version: 1, ...r };
    delete out.source; delete out.path; delete out.team;
    for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
    write(path.join(dir, STACKS_FOLDER, `${r.id}.json`), out);
  }
  return written;
}
