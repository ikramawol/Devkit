import { test } from "node:test";
import assert from "node:assert/strict";
import { EXTENSION_RETRY_MS, extensionError, installExtensions } from "../src/migrate/editors.js";
import { askYesNo, STALE_INPUT_MS } from "../src/utils/prompt.js";
import type { Logger } from "../src/utils/logger.js";
import type { Runner, RunResult } from "../src/utils/run.js";
import { fail, ok } from "./helpers.js";

function recordingLog() {
  const lines: string[] = [];
  const log: Logger = {
    info: (m) => lines.push(`info ${m}`), step: (m) => lines.push(`step ${m}`), ok: (m) => lines.push(`ok ${m}`),
    warn: (m) => lines.push(`warn ${m}`), error: (m) => lines.push(`error ${m}`),
  };
  return { log, lines };
}

/** `code` that answers each extension from a queue of results (last one repeats). */
function codeRunner(answers: Record<string, RunResult[]>) {
  const calls: string[] = [];
  const runner = {
    which: () => "/fake/bin/code",
    refreshPath: () => {},
    powershell: () => ok(),
    run: (_cmd: string, args: string[] = []) => {
      calls.push(args.join(" "));
      const queue = answers[args[1]] ?? [ok()];
      return queue.length > 1 ? queue.shift()! : queue[0];
    },
  } as Runner;
  return { runner, calls };
}

const VSCODE_NOISE =
  "(node:29512) [DEP0169] DeprecationWarning: `url.parse()` behavior is not standardized\n(Use `Code --trace-deprecation ...` to show where the warning was created)";

test("extension errors: the editor's own message, without Node's warnings", () => {
  assert.equal(
    extensionError(fail(`${VSCODE_NOISE}\nFailed Installing Extensions: eamodio.gitlens\nRequest failed: ETIMEDOUT`)),
    "Request failed: ETIMEDOUT",
  );
  assert.equal(extensionError({ ok: false, code: 1, stdout: "Extension 'x.y' not found.", stderr: VSCODE_NOISE }), "Extension 'x.y' not found.");
  assert.equal(extensionError({ ok: false, code: 3, stdout: "", stderr: "" }), "exit code 3");
});

test("extensions that fail are retried once after a pause", async () => {
  const { runner, calls } = codeRunner({ "eamodio.gitlens": [fail("rate limited"), ok()] });
  const { log, lines } = recordingLog();
  const waits: number[] = [];
  const failed = await installExtensions("code", ["prisma.prisma", "eamodio.gitlens"], {
    runner, log, force: true, sleep: async (ms) => { waits.push(ms); },
  });
  assert.deepEqual(failed, []);
  assert.deepEqual(waits, [EXTENSION_RETRY_MS]);
  assert.equal(calls.filter((c) => c.includes("eamodio.gitlens")).length, 2);
  assert.ok(calls.every((c) => c.endsWith("--force")));
  assert.ok(lines.includes("ok eamodio.gitlens"));
  assert.ok(!lines.some((l) => l.startsWith("warn")), "no warning when the retry worked");
});

test("no pause when everything installs", async () => {
  const { runner } = codeRunner({});
  let waited = false;
  await installExtensions("code", ["a.b", "c.d"], { runner, log: recordingLog().log, sleep: async () => { waited = true; } });
  assert.equal(waited, false);
});

test("an extension that keeps failing shows the real reason; 'may not exist' only across OSes", async () => {
  const answers = () => ({ "x.y": [fail(`${VSCODE_NOISE}\nExtension 'x.y' not found.`)] });
  const same = recordingLog();
  const failed = await installExtensions("code", ["x.y"], { runner: codeRunner(answers()).runner, log: same.log, sleep: async () => {} });
  assert.deepEqual(failed, [{ ext: "x.y", reason: "Extension 'x.y' not found." }]);
  assert.ok(same.lines.includes("warn x.y: could not install: Extension 'x.y' not found."), same.lines.join("\n"));

  const cross = recordingLog();
  await installExtensions("code", ["x.y"], { runner: codeRunner(answers()).runner, log: cross.log, otherOs: "linux", sleep: async () => {} });
  assert.ok(cross.lines.some((l) => l.endsWith("(it may not exist for linux)")));
});

/** A clock and a terminal: each answer comes `delay` ms after the question. */
function terminal(answers: [string | null, number][]) {
  let time = 0;
  const prompts: string[] = [];
  return {
    prompts,
    now: () => time,
    readLine: async (prompt: string) => {
      prompts.push(prompt);
      const [answer, delay] = answers.shift() ?? [null, 0];
      time += delay;
      return answer;
    },
  };
}

test("confirm: Enter pressed before the question appeared is ignored, and the question is asked again", async () => {
  const t = terminal([["", 1], ["y", 2000]]);
  assert.equal(await askYesNo("\nInstall 4 tool(s)?", t.readLine, t.now), true);
  assert.deepEqual(t.prompts, ["\nInstall 4 tool(s)? [y/N] ", "Install 4 tool(s)? [y/N] "]);
});

test("confirm: a 'y' typed ahead doesn't count either", async () => {
  const t = terminal([["y", 0], ["", 1500]]);
  assert.equal(await askYesNo("Continue?", t.readLine, t.now), false);
});

test("confirm: a real answer is used, Enter means no, closed input means no", async () => {
  for (const [answer, want] of [["y", true], ["YES", true], ["", false], ["n", false]] as const) {
    const t = terminal([[answer, STALE_INPUT_MS + 1]]);
    assert.equal(await askYesNo("Go?", t.readLine, t.now), want, `answer ${JSON.stringify(answer)}`);
  }
  const closed = terminal([[null, 0]]);
  assert.equal(await askYesNo("Go?", closed.readLine, closed.now), false);
});

test("confirm: gives up (no) if input keeps arriving instantly", async () => {
  const t = terminal([["", 0], ["", 0], ["", 0], ["y", 5000]]);
  assert.equal(await askYesNo("Go?", t.readLine, t.now), false);
  assert.equal(t.prompts.length, 3);
});
