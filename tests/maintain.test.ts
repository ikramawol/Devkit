import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import type { Runner, RunResult } from "../src/utils/run.js";
import { setIsRoot } from "../src/adapters/methods.js";
import {
  checkUpdates, describeStep, executeMaintenance, parseAptUpgradable, parseWingetUpgrade, planMaintenance,
} from "../src/maintain/maintain.js";
import { copiesOnPath, diagnose } from "../src/maintain/diagnose.js";
import { silentLogger } from "../src/utils/logger.js";
import { ok, tempPlatform } from "./helpers.js";

/** A fake computer: `installed` commands are on PATH; `answer` can reply to any command line. */
function machine(installed: string[], answer: (line: string, args: string[]) => RunResult | undefined = () => undefined) {
  const calls: string[] = [];
  const runner: Runner = {
    which: (c) => (installed.includes(c) ? `/bin/${c}` : null),
    refreshPath() {},
    run: (cmd, args = []) => {
      const line = `${cmd.replace(/^\/bin\//, "")} ${args.join(" ")}`.trim();
      calls.push(line);
      return answer(line, args) ?? (args[0] === "--version" || args[0] === "-V" ? ok("1.2.3") : ok());
    },
    powershell: (s) => { calls.push(`ps ${s}`); return ok(); },
  };
  return { runner, calls };
}

/** What `winget export` writes: the ids winget sees as installed. */
const wingetExport = (ids: string[]) => (line: string, args: string[]) => {
  if (!line.startsWith("winget export")) return undefined;
  writeFileSync(args[2], JSON.stringify({ Sources: [{ Packages: ids.map((PackageIdentifier) => ({ PackageIdentifier })) }] }));
  return ok();
};

// Real `winget upgrade` output (with the progress spinner it prints first).
const WINGET_UPGRADE = "   -\r   \\\r" + `Name                Id                   Version              Available            Source
-----------------------------------------------------------------------------------------
Docker Desktop      Docker.DockerDesktop 4.99.0               4.100.0              winget
Git                 Git.Git              2.56.0.2             2.56.1               winget
Node.js             OpenJS.NodeJS.24     24.22.0              24.22.3              winget
Postman x64 12.37.1 Postman.Postman      12.37.1              12.37.4              winget
Python Launcher     Python.Launcher      < 3.15.2             3.15.2               winget
5 upgrades available.
`.replace(/\n/g, "\r\n"); // winget ends lines with CRLF

// ── Finding updates ─────────────────────────────────────────

test("winget's upgrade table is read by column, so long names and '< 3.15.2' versions work", () => {
  const m = parseWingetUpgrade(WINGET_UPGRADE);
  assert.deepEqual(m.get("git.git"), { current: "2.56.0.2", latest: "2.56.1" });
  assert.deepEqual(m.get("postman.postman"), { current: "12.37.1", latest: "12.37.4" });
  assert.deepEqual(m.get("python.launcher"), { current: "< 3.15.2", latest: "3.15.2" });
  assert.equal(m.size, 5);
  assert.equal(parseWingetUpgrade("No installed package found matching input criteria.").size, 0);
});

test("Windows: updates from winget (Node.js under another id too) and from npm", () => {
  const platform = tempPlatform("windows");
  const { runner } = machine(["winget", "npm"], (line) => {
    if (line.startsWith("winget upgrade")) return ok(WINGET_UPGRADE);
    // npm exits with 1 when something is outdated.
    if (line === "npm outdated -g --json") return { ok: false, code: 1, stderr: "", stdout: JSON.stringify({ prettier: { current: "3.3.0", latest: "3.4.2" }, pnpm: { current: "9.0.0", latest: "9.0.0" } }) };
    return undefined;
  });
  const { updates } = checkUpdates({ runner, platform });
  assert.deepEqual(updates.map((u) => u.id), ["git", "node", "docker", "postman", "prettier"]);
  assert.deepEqual(updates.find((u) => u.id === "node"), { id: "node", name: "Node.js + npm", via: "winget", current: "24.22.0", latest: "24.22.3" });
  assert.equal(updates.find((u) => u.id === "prettier")?.via, "npm");
});

test("macOS: Homebrew formulae and casks; Linux: apt's upgradable list", () => {
  const mac = machine(["brew"], (line) => line === "brew outdated --json=v2" ? ok(JSON.stringify({
    formulae: [{ name: "git", installed_versions: ["2.44.0"], current_version: "2.45.0" }],
    casks: [{ name: "visual-studio-code", installed_versions: ["1.90.0"], current_version: "1.91.0" }],
  })) : undefined);
  assert.deepEqual(checkUpdates({ runner: mac.runner, platform: tempPlatform("macos") }).updates.map((u) => `${u.id} ${u.current}→${u.latest}`), ["git 2.44.0→2.45.0", "vscode 1.90.0→1.91.0"]);

  const apt = "Listing...\ngit/noble-updates 1:2.43.0-1ubuntu7.2 amd64 [upgradable from: 1:2.43.0-1ubuntu7.1]\nnpm/noble 9.2.0 all [upgradable from: 9.1.0]";
  assert.equal(parseAptUpgradable(apt).size, 2);
  const linux = machine(["apt"], (line) => line === "apt list --upgradable" ? ok(apt) : undefined);
  assert.deepEqual(checkUpdates({ runner: linux.runner, platform: tempPlatform("linux") }).updates.map((u) => u.id), ["git", "node"]);
});

// ── Plans ───────────────────────────────────────────────────

test("update plan: only tools the installer really has; the rest say why", () => {
  const platform = tempPlatform("windows");
  const { runner } = machine(["git", "claude", "psql", "winget"], wingetExport(["Git.Git"]));
  const exists = (p: string) => p.endsWith("bash.exe"); // Git Bash is there
  const plan = planMaintenance("update", ["git", "git-bash", "claude", "postgresql", "vscode", "nope", "hono"], { runner, platform, exists });

  assert.deepEqual(plan.ready.map((r) => `${r.item.id}: ${describeStep(r.step)}`), [
    "git: winget upgrade --id Git.Git --exact --silent --accept-source-agreements --disable-interactivity --accept-package-agreements",
    "claude: claude update",
  ]);
  const why = Object.fromEntries(plan.cannot.map((x) => [x.item.id, x.reason]));
  assert.match(why["git-bash"], /updated together with Git/);
  assert.match(why.postgresql, /wasn't installed with winget/, "installed some other way: left alone");
  assert.deepEqual(plan.notInstalled.map((i) => i.id), ["vscode"]);
  assert.deepEqual(plan.unknown, ["nope", "hono"]);
});

test("uninstall plan: dependents first, apt asks itself, and Linux keeps its Python", () => {
  setIsRoot(() => false);
  const platform = tempPlatform("linux");
  const { runner } = machine(["node", "npm", "prettier", "pnpm", "python3", "claude", "dpkg-query"], (line) => {
    if (line.startsWith("dpkg-query") && line.endsWith(" nodejs")) return ok("install ok installed");
    if (line.startsWith("npm ls -g")) return ok(JSON.stringify({ dependencies: { prettier: { version: "3.3.0" } } }));
    return undefined;
  });
  const plan = planMaintenance("uninstall", ["node", "prettier", "python", "claude"], { runner, platform, exists: () => false });

  assert.deepEqual(plan.ready.map((r) => describeStep(r.step)), ["npm uninstall -g prettier", "sudo apt-get remove nodejs npm"],
    "prettier first (it needs npm to uninstall), and no -y so apt shows what it removes");
  const why = Object.fromEntries(plan.cannot.map((x) => [x.item.id, x.reason]));
  assert.match(why.python, /Linux itself runs on Python/);
  assert.match(why.claude, /~\/\.local\/bin\/claude/);
  assert.deepEqual(plan.dependents.map((d) => d.item.id), ["pnpm"], "pnpm needs Node.js and isn't being removed");
});

test("Claude Code installed from npm (the older way) is updated and removed with npm", () => {
  const platform = tempPlatform("windows");
  const { runner } = machine(["claude", "npm"], (line) => {
    if (line.startsWith("npm ls -g")) return ok(JSON.stringify({ dependencies: { "@anthropic-ai/claude-code": {} } }));
    if (line === "npm outdated -g --json") return { ok: false, code: 1, stderr: "", stdout: JSON.stringify({ "@anthropic-ai/claude-code": { current: "2.1.323", latest: "2.1.330" } }) };
    return undefined;
  });
  const deps = { runner, platform, exists: () => false };
  assert.deepEqual(checkUpdates(deps).updates.map((u) => `${u.id} ${u.via} ${u.current}→${u.latest}`), ["claude npm 2.1.323→2.1.330"]);
  assert.equal(describeStep(planMaintenance("update", ["claude"], deps).ready[0].step), "npm install -g @anthropic-ai/claude-code@latest");
  assert.equal(describeStep(planMaintenance("uninstall", ["claude"], deps).ready[0].step), "npm uninstall -g @anthropic-ai/claude-code");
});

test("removing Node.js: npm-installed Claude Code goes first, and is listed as needing Node.js", () => {
  const platform = tempPlatform("windows");
  const { runner } = machine(["claude", "npm", "node", "winget"], (line, args) => {
    if (line.startsWith("npm ls -g")) return ok(JSON.stringify({ dependencies: { "@anthropic-ai/claude-code": {} } }));
    return wingetExport(["OpenJS.NodeJS.24"])(line, args);
  });
  const deps = { runner, platform, exists: () => false };
  assert.deepEqual(planMaintenance("uninstall", ["node", "claude"], deps).ready.map((r) => r.item.id), ["claude", "node"]);
  assert.deepEqual(planMaintenance("uninstall", ["node"], deps).dependents.map((d) => d.item.id), ["claude"]);
});

test("WSL: Windows' npm showing through on PATH isn't used for Linux updates", () => {
  const platform = { ...tempPlatform("linux"), wsl: true };
  const { runner, calls } = machine([], () => undefined);
  runner.which = (c) => (c === "npm" ? "/mnt/c/Program Files/nodejs/npm" : null);
  assert.deepEqual(checkUpdates({ runner, platform }).updates, []);
  assert.ok(!calls.some((l) => l.startsWith("npm")), "Windows' npm was never asked");
});

// ── Running ─────────────────────────────────────────────────

test("an update is checked by the new version; a failed one is reported", () => {
  const platform = tempPlatform("windows");
  let gitVersion = "2.56.0";
  const { runner } = machine(["git", "gh", "winget"], (line, args) => {
    if (line === "git --version") return ok(`git version ${gitVersion}`);
    if (line.startsWith("winget upgrade --id Git.Git")) { gitVersion = "2.56.1"; return ok(); }
    if (line.startsWith("winget upgrade --id GitHub.cli")) return { ok: false, code: 1, stdout: "", stderr: "" };
    return wingetExport(["Git.Git", "GitHub.cli"])(line, args);
  });
  const deps = { runner, platform, exists: () => false, log: silentLogger };
  const results = executeMaintenance(planMaintenance("update", ["git", "gh"], deps), deps);
  assert.deepEqual(results.map((r) => [r.id, r.outcome, r.before, r.after]), [
    ["git", "updated", "2.56.0", "2.56.1"],
    ["gh", "failed", "1.2.3", undefined],
  ]);
});

test("an uninstall counts only when the tool is really gone", () => {
  const platform = tempPlatform("linux");
  const installed = ["npm", "prettier", "eslint"];
  const { runner } = machine(installed, (line) => {
    if (line.startsWith("npm ls -g")) return ok(JSON.stringify({ dependencies: { prettier: {}, eslint: {} } }));
    if (line === "npm uninstall -g prettier") { installed.splice(installed.indexOf("prettier"), 1); return ok(); }
    return undefined; // eslint's uninstall "succeeds" but it's still there
  });
  const deps = { runner, platform, exists: () => false, log: silentLogger };
  const results = executeMaintenance(planMaintenance("uninstall", ["prettier", "eslint"], deps), deps);
  assert.deepEqual(results.map((r) => [r.id, r.outcome]), [["prettier", "removed"], ["eslint", "unverified"]]);
});

// ── Diagnose ────────────────────────────────────────────────

test("copies of a tool are counted once per real file (/bin and /usr/bin are often the same)", () => {
  const files = new Set(["/bin/git", "/usr/bin/git", "/usr/local/bin/git"]);
  const copies = copiesOnPath("git", ["/bin", "/usr/bin", "/usr/local/bin", "/usr/bin/"], "linux", {
    isFile: (p) => files.has(p),
    realpath: (p) => (p === "/bin/git" ? "/usr/bin/git" : p),
  });
  assert.deepEqual(copies, ["/bin/git", "/usr/local/bin/git"]);
});

test("Windows diagnose: dead and doubled PATH folders, the Store's python, two Node.js, tools off PATH", () => {
  const platform = tempPlatform("windows");
  const apps = "C:\\Users\\me\\AppData\\Local\\Microsoft\\WindowsApps";
  const env = { PATH: `C:\\A;C:\\a\\;C:\\Gone;${apps};C:\\Python313;C:\\nodejs;C:\\nvm\\node`, PATHEXT: ".COM;.EXE;.BAT;.CMD;.PS1" };
  const files = new Set([`${apps}\\python.exe`, "C:\\Python313\\python.exe", "C:\\nodejs\\node.exe", "C:\\nvm\\node\\node.exe"]);
  const { runner } = machine(["python", "node", "npm"], (line) => (line === "npm prefix -g" ? ok("C:\\Users\\me\\AppData\\Roaming\\npm") : undefined));

  const report = diagnose({
    runner, platform, env,
    exists: (p) => p.endsWith("claude.exe"), // Claude Code is installed, but ~/.local/bin isn't on PATH
    isDir: (p) => !p.includes("Gone"),
    isFile: (p) => files.has(p),
    realpath: (p) => p,
  }, { updates: false });

  const titles = report.findings.map((f) => `${f.level}: ${f.title}`);
  const find = (re: RegExp) => report.findings.find((f) => re.test(f.title));
  assert.deepEqual(find(/don't exist/)?.lines, ["C:\\Gone"]);
  assert.deepEqual(find(/more than once/)?.lines, ["C:\\a\\"]);
  assert.equal(find(/Microsoft Store/)?.level, "problem");
  assert.match(find(/Microsoft Store/)!.fix!, /App execution aliases/);
  assert.deepEqual(find(/copies of `node`/)?.lines, ["C:\\nodejs\\node.exe  ← runs", "C:\\nvm\\node\\node.exe"]);
  assert.match(find(/Claude Code is installed/)!.fix!, /\.local\\bin to PATH/);
  assert.deepEqual(find(/npm's global folder/)?.lines, ["C:\\Users\\me\\AppData\\Roaming\\npm"]);
  assert.equal(titles.length, 6, titles.join("\n"));
  assert.equal(report.checkedUpdates, false);
});
