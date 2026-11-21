import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  compareManifest, compareVersions, differenceCount, loadManifest, scanEnvironment, validateManifest, type Manifest,
} from "../src/manifest/manifest.js";
import { fixDifferences } from "../src/manifest/status.js";
import { createBackup } from "../src/migrate/export.js";
import { readProject } from "../src/core/project.js";
import { silentLogger } from "../src/utils/logger.js";
import { engineCtx, fakeRunner, ok, tempPlatform } from "./helpers.js";

function put(file: string, content: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/** A Windows PC with Git, Node.js and VS Code, a PowerShell profile holding an API key, and an MCP server with a token. */
function devPc(installed = ["git", "node", "npm", "code"]) {
  const platform = tempPlatform("windows");
  put(path.join(platform.home, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1"),
    `$env:OPENAI_API_KEY = "sk-abcdefghijklmnopqrstuvwxyz"\nSet-Alias g git\n`);
  put(path.join(platform.home, ".claude.json"), JSON.stringify({ mcpServers: { github: { command: "gh-mcp", env: { GITHUB_TOKEN: "ghp_x" } } } }));
  const { runner, calls } = fakeRunner({
    installed: new Set(installed),
    responses: {
      "code --list-extensions": ok("esbenp.prettier-vscode\ndbaeumer.vscode-eslint"),
      "git config --global --list": ok([
        "user.name=Ikram", "user.email=me@example.com", "credential.helper=manager",
        "init.defaultbranch=main", "pull.rebase=true", "alias.co=checkout",
        `core.excludesfile=${path.join(platform.home, ".gitignore_global")}`,
      ].join("\n")),
      "npm ls -g": ok(JSON.stringify({ dependencies: { npm: {}, typescript: {}, prettier: {} } })),
    },
  });
  return { platform, runner, calls };
}

// ── Scan ────────────────────────────────────────────────────

test("scan describes the machine without personal details or secret values", () => {
  const { platform, runner } = devPc();
  const m = scanEnvironment(engineCtx(runner, platform));

  assert.deepEqual(m.tools.map((t) => t.id), ["git", "node", "vscode"]);
  assert.equal(m.tools[0].version, "1.2.3");
  assert.deepEqual(m.editors, [{ id: "vscode", extensions: ["esbenp.prettier-vscode", "dbaeumer.vscode-eslint"] }]);
  assert.deepEqual(m.npmGlobals, ["typescript"], "prettier is a catalog tool, npm itself is skipped");
  assert.deepEqual(m.git, { "init.defaultbranch": ["main"], "pull.rebase": ["true"], "alias.co": ["checkout"] });
  assert.deepEqual(m.shells, ["powershell"]);
  assert.deepEqual(m.secrets.map((s) => [s.name, s.kind]), [["OPENAI_API_KEY", "env"], ["GITHUB_TOKEN", "config"]]);

  const text = JSON.stringify(m);
  for (const leak of ["sk-abc", "ghp_x", "me@example.com", "Ikram", "manager", platform.hostname, platform.home.replace(/\\/g, "\\\\")])
    assert.ok(!text.includes(leak), `manifest must not contain ${leak}`);
  assert.doesNotThrow(() => validateManifest(JSON.parse(text)), "a scanned manifest is always valid");
});

test("scan inside a project records its package manager and libraries", () => {
  const { platform, runner } = devPc();
  const dir = mkdtempSync(path.join(os.tmpdir(), "dkit-proj-"));
  put(path.join(dir, "package.json"), JSON.stringify({ name: "api", dependencies: { hono: "^4.6.0", react: "^19.0.0" } }));
  put(path.join(dir, "pnpm-lock.yaml"), "");
  const m = scanEnvironment({ ...engineCtx(runner, platform), project: readProject(dir)! });
  assert.deepEqual(m.project, { name: "api", pm: "pnpm", libraries: [{ id: "hono", version: "4.6.0" }] }, "only catalog libraries");
});

// ── Validation ──────────────────────────────────────────────

const base = (): Manifest => ({
  format: "dkit-manifest", version: 1, createdAt: "2026-11-20T00:00:00Z", source: { os: "windows", arch: "x64" },
  tools: [], editors: [], npmGlobals: [], git: {}, shells: [], secrets: [],
});

test("a manifest from someone else can't smuggle in options or values", () => {
  assert.throws(() => validateManifest({ format: "dkit-backup" }), /not a dkit manifest/);
  assert.throws(() => validateManifest({ ...base(), tools: [{ id: "Bad Id" }] }), /not a valid id/);
  assert.throws(() => validateManifest({ ...base(), npmGlobals: ["--prefix"] }), /not an npm package name/);
  assert.throws(() => validateManifest({ ...base(), editors: [{ id: "vscode", extensions: ["-x.y"] }] }), /not an extension id/);
  assert.throws(() => validateManifest({ ...base(), git: { "pull.rebase": ["true\n[alias]"] } }), /bad value/);
  assert.throws(() => validateManifest({ ...base(), secrets: [{ name: "K", where: "x", kind: "env", value: "v" }] }), /only hold a name/);
});

test("versions compare part by part", () => {
  assert.equal(compareVersions("1.10.0", "1.9"), 1);
  assert.equal(compareVersions("20.11.0", "24.1"), -1);
  assert.equal(compareVersions("2.47", "2.47.0"), 0);
});

// ── Compare ─────────────────────────────────────────────────

/** What the "old PC" had. */
const wanted = (): Manifest => ({
  ...base(),
  tools: [{ id: "git", version: "1.0" }, { id: "node", version: "99.0" }, { id: "gh" }, { id: "future-tool" }],
  editors: [{ id: "vscode", extensions: ["esbenp.prettier-vscode", "prisma.prisma"] }],
  npmGlobals: ["typescript", "tsx"],
  git: { "init.defaultbranch": ["main"], "pull.rebase": ["false"], "core.sshcommand": ["ssh -i key"] },
  secrets: [
    { name: "OPENAI_API_KEY", where: "PowerShell profile", kind: "env" },
    { name: "ANTHROPIC_API_KEY", where: "PowerShell profile", kind: "env" },
    { name: "GITHUB_TOKEN", where: "Claude Code MCP server \"github\"", kind: "config" },
  ],
});

test("compare: missing, older, unknown, extensions, npm, Git and secrets", () => {
  const { platform, runner } = devPc();
  const cmp = compareManifest(wanted(), { ...engineCtx(runner, platform), env: { OPENAI_API_KEY: "sk-real" } });

  assert.deepEqual(cmp.tools.map((t) => [t.id, t.state]), [["git", "ok"], ["node", "older"], ["gh", "missing"], ["future-tool", "unknown"]]);
  assert.match(cmp.tools[1].hint!, /winget upgrade --id OpenJS\.NodeJS\.LTS/);
  assert.deepEqual(cmp.extra.map((e) => e.id), ["vscode"], "on this PC but not in the manifest");
  assert.deepEqual(cmp.editors[0].missing, ["prisma.prisma"]);
  assert.deepEqual(cmp.npm.missing, ["tsx"]);
  assert.deepEqual(cmp.git.missing.map((g) => g.key), ["core.sshcommand"], "init.defaultbranch is already main");
  assert.equal(cmp.git.missing[0].safe, false, "core.sshCommand can run programs");
  assert.deepEqual(cmp.git.different.map((g) => [g.key, g.have, g.want]), [["pull.rebase", ["true"], ["false"]]]);
  assert.deepEqual(cmp.secrets.map((s) => s.set), [true, false, undefined]);
  // node older, gh missing, future-tool unknown, 1 extension, 1 npm, 1 git missing, 1 git different, 1 secret unset
  assert.equal(differenceCount(cmp), 8);
});

test("a PC that matches its own scan has no differences", () => {
  const { platform, runner } = devPc();
  const ctx = engineCtx(runner, platform);
  const m = scanEnvironment(ctx);
  assert.equal(differenceCount(compareManifest(m, { ...ctx, env: { OPENAI_API_KEY: "x" } })), 0);
});

// ── Fix ─────────────────────────────────────────────────────

test("fix: installs missing tools, then extensions, npm packages and only safe Git settings", async () => {
  const { platform, runner, calls } = devPc();
  const ctx = engineCtx(runner, platform);
  const m = { ...wanted(), git: { "init.defaultbranch": ["trunk"], "push.autosetupremote": ["true"], "alias.st": ["status"], "core.sshcommand": ["evil"], "alias.x": ["!rm -rf ~"] } };
  await fixDifferences(compareManifest(m, { ...ctx, env: {} }), ctx);

  assert.ok(calls.some((c) => c.startsWith("winget install --id GitHub.cli")), "gh installed through the engine");
  assert.ok(calls.includes("code --install-extension prisma.prisma"));
  assert.ok(calls.includes("npm install -g tsx"));
  assert.ok(calls.includes("git config --global push.autosetupremote true"), "missing safe setting is set");
  assert.ok(calls.includes("git config --global alias.st status"), "a plain alias is safe");
  assert.ok(!calls.some((c) => c.includes("init.defaultbranch")), "an existing setting is never overwritten");
  assert.ok(!calls.some((c) => c.includes("core.sshcommand") || c.includes("alias.x")), "settings that run programs are never applied");
  assert.ok(!calls.some((c) => c.includes("future-tool")));
});

test("fix --dry-run changes nothing", async () => {
  const { platform, runner, calls } = devPc();
  const ctx = engineCtx(runner, platform, { dryRun: true });
  await fixDifferences(compareManifest(wanted(), { ...ctx, env: {} }), ctx);
  assert.ok(!calls.some((c) => /^winget install|--install-extension|npm install -g|git config --global [^-]/.test(c)), calls.join("\n"));
});

test("fix: an editor installed during the fix gets its extensions in the same run", async () => {
  const { platform, runner, calls } = devPc(["git", "node", "npm"]); // no VS Code yet
  const ctx = engineCtx(runner, platform);
  const m = { ...base(), tools: [{ id: "vscode" }], editors: [{ id: "vscode", extensions: ["prisma.prisma"] }] };
  await fixDifferences(compareManifest(m, ctx), ctx);
  const install = calls.findIndex((c) => c.includes("Microsoft.VisualStudioCode"));
  const ext = calls.indexOf("code --install-extension prisma.prisma");
  assert.ok(install >= 0 && ext > install, "VS Code first, then its extensions");
});

test("fix: project libraries from the manifest are added to the project here", async () => {
  const { platform, runner, calls } = devPc();
  const dir = mkdtempSync(path.join(os.tmpdir(), "dkit-proj-"));
  put(path.join(dir, "package.json"), JSON.stringify({ name: "api", dependencies: { hono: "^4.0.0" } }));
  const project = readProject(dir)!;
  const ctx = engineCtx(runner, platform, { projectDir: dir, project });
  const m = { ...base(), project: { pm: "npm" as const, libraries: [{ id: "hono" }, { id: "kysely" }] } };
  const cmp = compareManifest(m, ctx);
  assert.deepEqual(cmp.project?.libraries.map((l) => [l.id, l.state]), [["hono", "ok"], ["kysely", "missing"]]);
  await fixDifferences(cmp, ctx);
  assert.ok(calls.includes("npm install kysely"), calls.join("\n"));
});

// ── Backups carry the manifest ──────────────────────────────

test("a migrate backup includes the manifest, and status can read it", async () => {
  const { platform, runner } = devPc();
  const backup = createBackup({ runner, platform, log: silentLogger, exists: () => false });
  assert.deepEqual(backup.tools, ["git", "node", "vscode"]);
  assert.deepEqual(backup.manifest?.tools.map((t) => t.id), backup.tools);
  assert.ok(backup.git.config.some(([k]) => k === "user.email"), "the backup itself still keeps your Git identity");

  const dir = mkdtempSync(path.join(os.tmpdir(), "dkit-bk-"));
  const file = path.join(dir, "backup.json");
  writeFileSync(file, JSON.stringify(backup));
  assert.deepEqual((await loadManifest(file)).tools.map((t) => t.id), backup.tools);
  await assert.rejects(loadManifest(path.join(dir, "nope.json")), /no such file/);
});
