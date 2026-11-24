import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPlan, executePlan, installTools } from "../src/core/engine.js";
import type { RunResult } from "../src/utils/run.js";
import { engineCtx, fakeRunner, ok, tempPlatform } from "./helpers.js";

const win = tempPlatform("windows");
const exit = (code: number): RunResult => ({ ok: code === 0, code, stdout: "", stderr: "" });

/** A fake Windows PC. Defaults: new build, virtualization on, no WSL, admin steps need a restart. */
function machine(o: { build?: string; virt?: boolean; vmp?: boolean; wslFeature?: boolean; wsl?: boolean; adminExit?: number } = {}) {
  return {
    // Elevated fix scripts come first: they must not match the check scripts below.
    "Start-Process": exit(o.adminExit ?? 3010),
    "OSVersion": ok(o.build ?? "26200"),
    "VirtualizationFirmwareEnabled": ok(o.virt === false ? "False" : "True"),
    "Name='VirtualMachinePlatform'": ok(o.vmp ? "1" : "2"),
    "Name='Microsoft-Windows-Subsystem-Linux'": ok(o.wslFeature ? "1" : "2"),
    "wsl.exe --version": ok(o.wsl ? "True" : "False"),
  };
}

const adminSteps = (calls: string[]) =>
  calls.filter((c) => c.includes("Start-Process")).map((c) => (c.includes("wsl.exe --install") ? "wsl" : c.match(/FeatureName (\S+)/)![1]));

test("Docker on a fresh PC: lists what it needs, with the missing ones pending", () => {
  const { runner } = fakeRunner({ installed: new Set(), ps: machine() });
  const plan = buildPlan(["docker"], engineCtx(runner, win));
  assert.deepEqual(plan.toInstall.map((i) => i.id), ["docker"]);
  assert.deepEqual(
    plan.prereqs.docker.map((p) => [p.key, p.ok]),
    [
      ["windows-build:19045", true],
      ["virtualization", true],
      ["windows-feature:VirtualMachinePlatform", false],
      ["windows-feature:Microsoft-Windows-Subsystem-Linux", false],
      ["wsl", false],
    ],
  );
});

test("prerequisites are set up in order, then Docker is installed", async () => {
  const { runner, calls } = fakeRunner({ installed: new Set(), ps: machine() });
  const ctx = engineCtx(runner, win);
  const report = await executePlan(buildPlan(["docker"], ctx), ctx);

  assert.deepEqual(adminSteps(calls), ["VirtualMachinePlatform", "Microsoft-Windows-Subsystem-Linux", "wsl"]);
  const lastAdmin = calls.findLastIndex((c) => c.includes("Start-Process"));
  const install = calls.findIndex((c) => c.includes("install") && c.includes("Docker.DockerDesktop"));
  assert.ok(install > lastAdmin, "Docker must install after its prerequisites");
  assert.deepEqual(report.results.map((r) => [r.id, r.outcome]), [["docker", "installed"]]);
  assert.deepEqual(report.restartFor, ["Virtual Machine Platform", "Windows Subsystem for Linux", "WSL 2"]);
});

test("only the missing prerequisites are set up", async () => {
  const { runner, calls } = fakeRunner({ installed: new Set(), ps: machine({ vmp: true, wslFeature: true }) });
  const ctx = engineCtx(runner, win);
  await executePlan(buildPlan(["docker"], ctx), ctx);
  assert.deepEqual(adminSteps(calls), ["wsl"]);
});

test("virtualization off in BIOS: Docker is blocked and nothing is changed", async () => {
  const { runner, calls } = fakeRunner({ installed: new Set(), ps: machine({ virt: false }) });
  const ctx = engineCtx(runner, win);
  const plan = buildPlan(["docker"], ctx);
  assert.deepEqual(plan.blocked.map((i) => i.id), ["docker"]);
  assert.equal(plan.toInstall.length, 0);

  await installTools(["docker"], ctx);
  assert.equal(adminSteps(calls).length, 0);
  assert.ok(!calls.some((c) => c.includes("Docker.DockerDesktop") && c.includes("install")));
});

test("Windows too old: Docker is blocked", () => {
  const { runner } = fakeRunner({ installed: new Set(), ps: machine({ build: "18363" }) });
  const plan = buildPlan(["docker"], engineCtx(runner, win));
  assert.deepEqual(plan.blocked.map((i) => i.id), ["docker"]);
});

test("Docker installed but WSL missing: sets up WSL, doesn't reinstall Docker", async () => {
  const { runner, calls } = fakeRunner({ installed: new Set(["docker"]), ps: machine({ vmp: true, wslFeature: true }) });
  const ctx = engineCtx(runner, win);
  const plan = buildPlan(["docker"], ctx);
  assert.deepEqual(plan.repair.map((i) => i.id), ["docker"]);
  assert.equal(plan.toInstall.length, 0);

  const report = await installTools(["docker"], ctx);
  assert.deepEqual(adminSteps(calls), ["wsl"]);
  assert.ok(!calls.some((c) => c.includes("Docker.DockerDesktop") && c.includes("install")));
  assert.deepEqual(report?.results.map((r) => [r.id, r.outcome]), [["docker", "set-up"]]);
});

test("admin prompt cancelled: stops there and Docker is not installed", async () => {
  const { runner, calls } = fakeRunner({ installed: new Set(), ps: machine({ adminExit: 1 }) });
  const ctx = engineCtx(runner, win);
  const report = await executePlan(buildPlan(["docker"], ctx), ctx);
  assert.deepEqual(adminSteps(calls), ["VirtualMachinePlatform"]);
  assert.ok(!calls.some((c) => c.includes("Docker.DockerDesktop") && c.includes("install")));
  assert.equal(report.results[0].outcome, "failed");
  assert.match(report.results[0].message ?? "", /Virtual Machine Platform/);
});

test("dry run shows the checklist but changes nothing", async () => {
  const { runner, calls } = fakeRunner({ installed: new Set(), ps: machine() });
  await installTools(["docker"], engineCtx(runner, win, { dryRun: true }));
  assert.equal(adminSteps(calls).length, 0);
});

test("Linux: Docker has no Windows prerequisites", () => {
  const { runner, calls } = fakeRunner({ installed: new Set() });
  const plan = buildPlan(["docker"], engineCtx(runner, tempPlatform("linux")));
  assert.deepEqual(plan.prereqs, {});
  assert.ok(!calls.some((c) => c.startsWith("ps ")));
});
