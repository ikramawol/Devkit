import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { detectItem } from "../src/core/detect.js";
import { buildPlan, executePlan } from "../src/core/engine.js";
import { getItem } from "../src/core/catalog.js";
import { engineCtx, fail, fakeRunner, ok, tempPlatform } from "./helpers.js";

const win = tempPlatform("windows");

/**
 * A Windows PC where `winget export` reports `packages` (null = winget export fails).
 * `winget install --id X` adds X to the list, like a real install would.
 */
function wingetPc(packages: string[] | null) {
  const { runner, calls } = fakeRunner({ installed: new Set(["winget"]) });
  const run = runner.run;
  runner.run = (cmd, args = [], opts) => {
    if (cmd === "winget" && args[0] === "export") {
      calls.push("winget export");
      if (!packages) return fail();
      writeFileSync(args[2], JSON.stringify({ Sources: [{ Packages: packages.map((PackageIdentifier) => ({ PackageIdentifier })) }] }));
      return ok();
    }
    if (cmd === "winget" && args[0] === "install" && packages) packages.push(args[2]);
    return run(cmd, args, opts);
  };
  return { runner, calls };
}

test("doctor-style checks ask winget once for every tool, not once per tool", () => {
  const { runner, calls } = wingetPc(["Postman.Postman", "MongoDB.Compass.Full"]);
  const ctx = engineCtx(runner, win);
  const found = ["postman", "compass", "pgadmin", "gh"].map((id) => detectItem(getItem(id)!, ctx).installed);

  assert.deepEqual(found, [true, true, false, false]);
  assert.equal(calls.filter((c) => c === "winget export").length, 1);
  assert.ok(!calls.some((c) => c.startsWith("winget list")), "no slow per-tool lookups");
});

test("winget ids match regardless of case", () => {
  const { runner } = wingetPc(["postman.postman"]);
  assert.ok(detectItem(getItem("postman")!, engineCtx(runner, win)).installed);
});

test("if winget export fails, falls back to asking about each tool", () => {
  const { runner, calls } = wingetPc(null);
  detectItem(getItem("postman")!, engineCtx(runner, win));
  assert.ok(calls.some((c) => c.startsWith("winget list --id Postman.Postman")));
});

test("after installing, the tool is re-checked against a fresh winget list", async () => {
  const { runner, calls } = wingetPc([]);
  const ctx = engineCtx(runner, win);
  const report = await executePlan(buildPlan(["postman"], ctx), ctx);
  assert.deepEqual(report.results.map((r) => [r.id, r.outcome]), [["postman", "installed"]]);
  assert.equal(calls.filter((c) => c === "winget export").length, 2, "once to plan, once to verify");
});

test("Windows: WSL's bash.exe is not mistaken for Git Bash (and isn't started)", () => {
  const { runner, calls } = fakeRunner({ installed: new Set(["bash"]) }); // `bash` on PATH = WSL launcher
  const gitBash = getItem("git-bash")!;
  assert.equal(detectItem(gitBash, engineCtx(runner, win)).installed, false);
  assert.ok(!calls.some((c) => c.startsWith("bash")), "never runs bash on Windows");

  const withGit = engineCtx(runner, win, { exists: (p) => /Git[\\/]bin[\\/]bash\.exe$/.test(p) });
  assert.equal(detectItem(gitBash, withGit).installed, true, "found by its install path instead");
  assert.equal(detectItem(gitBash, engineCtx(runner, tempPlatform("linux"))).installed, true, "on Linux the bash command is right");
});
