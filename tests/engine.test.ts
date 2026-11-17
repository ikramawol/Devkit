import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlan, executePlan, installTools } from "../src/core/engine.js";
import { CATALOG } from "../src/core/catalog.js";
import { engineCtx, fakeRunner, tempPlatform } from "./helpers.js";

const win = tempPlatform("windows");

test("catalog has all 18 requested tools with a Windows method", () => {
  const ids = ["git", "git-bash", "openssh", "gh", "node", "python", "vscode", "antigravity", "claude", "codex",
    "postgresql", "pgadmin", "mongodb", "compass", "docker", "postman", "prettier", "eslint"];
  for (const id of ids) {
    const item = CATALOG.find((i) => i.id === id);
    assert.ok(item, `missing ${id}`);
    assert.ok(item.install.windows, `${id} has no Windows installer`);
  }
});

test("picking codex adds Node.js first, automatically", () => {
  const { runner } = fakeRunner({ installed: new Set() });
  const plan = buildPlan(["codex"], engineCtx(runner, win));
  assert.deepEqual(plan.toInstall.map((i) => i.id), ["node", "codex"]);
  assert.deepEqual(plan.addedDeps, ["node"]);
});

test("Claude Code on Windows installs Git first", () => {
  const { runner } = fakeRunner({ installed: new Set() });
  const plan = buildPlan(["claude"], engineCtx(runner, win));
  assert.deepEqual(plan.toInstall.map((i) => i.id), ["git", "claude"]);
});

test("already-installed tools are not reinstalled", () => {
  const { runner } = fakeRunner({ installed: new Set(["git", "node"]) });
  const plan = buildPlan(["git", "node", "prettier"], engineCtx(runner, win));
  assert.deepEqual(plan.toInstall.map((i) => i.id), ["prettier"]);
  assert.equal(plan.alreadyInstalled.length, 2);
});

test("only selected tools are installed, nothing else", async () => {
  const { runner, calls } = fakeRunner({ installed: new Set() });
  await installTools(["gh"], engineCtx(runner, win));
  const installs = calls.filter((c) => c.includes(" install "));
  assert.equal(installs.length, 1);
  assert.match(installs[0], /GitHub\.cli/);
});

test("dry run and 'no' change nothing", async () => {
  for (const extra of [{ dryRun: true }, { confirm: async () => false }]) {
    const { runner, calls } = fakeRunner({ installed: new Set() });
    await installTools(["docker", "postman"], engineCtx(runner, win, extra));
    assert.ok(!calls.some((c) => c.includes(" install ")));
  }
});

test("if Node fails, Codex is skipped instead of failing confusingly", async () => {
  const { runner } = fakeRunner({ installed: new Set(), failInstall: new Set(["OpenJS.NodeJS.LTS"]) });
  const ctx = engineCtx(runner, win);
  const report = await executePlan(buildPlan(["codex"], ctx), ctx);
  assert.deepEqual(report.results.map((r) => [r.id, r.outcome]), [["node", "failed"], ["codex", "skipped"]]);
});

test("Linux: tools without a package become manual downloads", () => {
  const { runner } = fakeRunner({ installed: new Set() });
  const plan = buildPlan(["postman", "git"], engineCtx(runner, tempPlatform("linux")));
  assert.deepEqual(plan.manual.map((m) => m.item.id), ["postman"]);
  assert.deepEqual(plan.toInstall.map((i) => i.id), ["git"]);
});
