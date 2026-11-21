import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CATALOG, getItem } from "../src/core/catalog.js";
import { detectItem } from "../src/core/detect.js";
import type { OS } from "../src/core/platform.js";
import { runMethod, setIsRoot } from "../src/adapters/methods.js";
import { listNpmGlobals } from "../src/manifest/discover.js";
import { createBackup } from "../src/migrate/export.js";
import { restoreBackup } from "../src/migrate/restore.js";
import { convertProfile, transformGit } from "../src/migrate/transform.js";
import { silentLogger } from "../src/utils/logger.js";
import { engineCtx, fakeRunner, ok, tempPlatform } from "./helpers.js";

function put(file: string, content: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

// ── Every tool on every OS ──────────────────────────────────

test("every machine tool says how to get it on Windows, macOS and Linux", () => {
  for (const item of CATALOG.filter((i) => i.kind === "machine"))
    for (const os of ["windows", "macos", "linux"] as OS[]) assert.ok(item.install[os], `${item.id} has nothing for ${os}`);
});

test("Python is found as python3 on macOS and Linux, python on Windows", () => {
  const python = getItem("python")!;
  for (const [os, cmd] of [["linux", "python3"], ["macos", "python3"], ["windows", "python"]] as const) {
    const { runner } = fakeRunner({ installed: new Set([cmd]) });
    assert.equal(detectItem(python, { runner, platform: tempPlatform(os), exists: () => false }).installed, true, os);
  }
  const { runner } = fakeRunner({ installed: new Set(["python"]) });
  assert.equal(detectItem(python, { runner, platform: tempPlatform("linux"), exists: () => false }).installed, false, "plain `python` isn't how Ubuntu ships it");
});

// ── WSL ─────────────────────────────────────────────────────

test("inside WSL, Windows programs (/mnt/c/...) don't count as Linux tools, except editors", () => {
  const { runner } = fakeRunner({ installed: new Set() });
  const windowsSide: Record<string, string> = {
    node: "/mnt/c/Program Files/nodejs/node", npm: "/mnt/c/Program Files/nodejs/npm",
    code: "/mnt/c/Users/me/AppData/Local/Programs/Microsoft VS Code/bin/code",
  };
  runner.which = (c) => windowsSide[c] ?? null;
  const wsl = { ...tempPlatform("linux"), wsl: true };
  const deps = { runner, platform: wsl, exists: () => false };
  assert.equal(detectItem(getItem("node")!, deps).installed, false, "Windows' Node can't run Linux scripts");
  assert.equal(detectItem(getItem("vscode")!, deps).installed, true, "VS Code on Windows is how you edit WSL files");
  assert.equal(listNpmGlobals(runner, wsl), null, "Windows' global npm packages aren't Linux ones");

  const plainLinux = { runner, platform: tempPlatform("linux"), exists: () => false };
  assert.equal(detectItem(getItem("node")!, plainLinux).installed, true, "outside WSL a /mnt path is just a path");
});

// ── apt ─────────────────────────────────────────────────────

test("apt: uses sudo normally, runs directly as root, explains when neither works", () => {
  try {
    setIsRoot(() => true);
    let r = fakeRunner({ installed: new Set(["apt-get"]) });
    assert.equal(runMethod({ type: "apt", packages: ["gh"] }, r.runner).ok, true);
    assert.ok(r.calls.includes("apt-get install -y gh") && !r.calls.some((c) => c.startsWith("sudo")), "root: no sudo needed (containers)");

    setIsRoot(() => false);
    r = fakeRunner({ installed: new Set(["apt-get", "sudo"]) });
    runMethod({ type: "apt", packages: ["gh"] }, r.runner);
    assert.ok(r.calls.includes("sudo apt-get install -y gh"));

    r = fakeRunner({ installed: new Set(["apt-get"]) });
    const res = runMethod({ type: "apt", packages: ["gh"] }, r.runner);
    assert.equal(res.manual, true);
    assert.match(res.message!, /needs admin rights/);
  } finally {
    setIsRoot(() => process.getuid?.() === 0);
  }
});

// ── Translating settings ────────────────────────────────────

test("Git: line endings follow the new OS; Windows-only editors aren't carried over", () => {
  assert.deepEqual(transformGit("core.autocrlf", ["true"], "windows", "linux").values, ["input"]);
  assert.deepEqual(transformGit("core.autocrlf", ["input"], "macos", "windows").values, ["true"]);
  assert.deepEqual(transformGit("core.autocrlf", ["true"], "windows", "windows").values, ["true"], "same OS: untouched");
  assert.equal(transformGit("core.editor", ["notepad++.exe -multiInst"], "windows", "macos").values, null);
  assert.deepEqual(transformGit("core.editor", ["code --wait"], "windows", "linux").values, ["code --wait"]);
  assert.deepEqual(transformGit("init.defaultbranch", ["main"], "windows", "linux").values, ["main"]);
});

test("PowerShell profile → bash: variables, aliases and simple functions; the rest is left out", () => {
  const ps = [
    "# my profile",
    `$env:EDITOR = "code --wait"`,
    `$env:GOPATH = "$env:USERPROFILE\\go"`,     // Windows path: left out
    `$env:OPENAI_API_KEY = "<REDACTED>"`,
    `$env:GREETING = 'it''s me'`,
    `$env:Path += ";C:\\Tools"`,                // PATH: left out
    "Set-Alias g git",
    "function gs { git status @args }",
    "Import-Module posh-git",                    // left out
  ].join("\r\n");
  const out = convertProfile(ps, "powershell", "Documents/PowerShell/profile.ps1");
  assert.match(out.text, /^export EDITOR="code --wait"$/m);
  assert.match(out.text, /^export OPENAI_API_KEY="<REDACTED>"$/m);
  assert.match(out.text, /^export GREETING='it'\\''s me'$/m, "PowerShell's '' becomes bash's '\\''");
  assert.match(out.text, /^alias g='git'$/m);
  assert.match(out.text, /^gs\(\) \{ git status "\$@"; \}$/m);
  assert.match(out.text, /fill them in/);
  assert.ok(!out.text.includes("GOPATH") && !out.text.includes("C:\\Tools") && !out.text.includes("posh-git"));
  assert.equal(out.converted, 5);
  assert.equal(out.skipped, 3);
});

test("bash profile → PowerShell: exports and aliases (built-in PowerShell aliases are cleared first)", () => {
  const sh = [
    "export EDITOR=vim",
    'export PROJECTS="$HOME/code"',
    'export GREETING="hi $USER"',
    'export PATH="$HOME/.local/bin:$PATH"',       // left out
    "export JAVA_HOME=/usr/lib/jvm/java-21",      // Unix path: left out
    "alias gs='git status'",
    "alias k=kubectl",
    "alias up='cd .. && ls'",                     // chained: left out
    'eval "$(starship init bash)"',               // left out
  ].join("\n");
  const out = convertProfile(sh, "bash", ".bashrc");
  assert.match(out.text, /^\$env:EDITOR = "vim"$/m);
  assert.match(out.text, /^\$env:PROJECTS = "\$HOME\/code"$/m);
  assert.match(out.text, /^\$env:GREETING = "hi \$env:USER"$/m);
  assert.match(out.text, /^Remove-Item Alias:gs -Force -ErrorAction SilentlyContinue\nfunction gs \{ git status @args \}$/m);
  assert.match(out.text, /^Set-Alias k kubectl$/m);
  assert.equal(out.converted, 5);
  assert.equal(out.skipped, 4);
});

// ── Whole restores across OSes ──────────────────────────────

/** A Windows PC: PowerShell profile, autocrlf=true, and an MCP server that runs a Windows .exe. */
function windowsPc() {
  const platform = tempPlatform("windows");
  put(path.join(platform.home, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1"), `$env:EDITOR = "code --wait"\nSet-Alias g git\n`);
  put(path.join(platform.home, ".claude", "CLAUDE.md"), "Be brief.");
  put(path.join(platform.home, ".claude.json"), JSON.stringify({
    mcpServers: { tools: { command: "C:\\Tools\\mcp.exe" }, files: { command: "npx", args: ["-y", "server-files"] } },
  }));
  const { runner } = fakeRunner({
    installed: new Set(["git", "claude"]),
    responses: { "git config --global --list": ok("core.autocrlf=true\ninit.defaultbranch=main") },
  });
  return createBackup({ runner, platform, log: silentLogger, exists: () => false });
}

test("restore Windows → Linux: profile converted, line endings fixed, Windows-only MCP server left out", async () => {
  const backup = windowsPc();
  const linux = tempPlatform("linux");
  const { runner, calls } = fakeRunner({ installed: new Set(["git", "claude"]) });
  const ctx = { ...engineCtx(runner, linux), select: async () => [], sections: ["git", "claude", "shell"] as never };
  const report = await restoreBackup(backup, ctx);

  const converted = path.join(linux.home, ".dkit", "converted", "profile.sh");
  assert.match(readFileSync(converted, "utf8"), /export EDITOR="code --wait"\nalias g='git'/);
  assert.ok(report.notes.some((n) => n.includes("source ~/.dkit/converted/profile.sh") && n.includes("~/.bashrc")));
  assert.ok(!existsSync(path.join(linux.home, "Documents")), "the PowerShell profile itself isn't written on Linux");

  assert.ok(calls.includes("git config --global core.autocrlf input"));
  assert.ok(report.notes.some((n) => n.includes("core.autocrlf")));

  assert.ok(calls.some((c) => c.startsWith("claude mcp add-json files")));
  assert.ok(!calls.some((c) => c.startsWith("claude mcp add-json tools")));
  assert.ok(report.notes.some((n) => n.includes(`MCP server "tools"`) && n.includes("C:\\Tools\\mcp.exe")));
});

test("restore macOS → Windows: .zshrc becomes a PowerShell file", async () => {
  const mac = tempPlatform("macos");
  put(path.join(mac.home, ".zshrc"), "export EDITOR=nvim\nalias ll='ls -la'\n");
  const { runner } = fakeRunner({ installed: new Set() });
  const backup = createBackup({ runner, platform: mac, log: silentLogger, exists: () => false });

  const win = tempPlatform("windows");
  const ctx = { ...engineCtx(fakeRunner({ installed: new Set() }).runner, win), select: async () => [], sections: ["shell"] as never };
  const report = await restoreBackup(backup, ctx);
  const ps1 = readFileSync(path.join(win.home, ".dkit", "converted", "profile.ps1"), "utf8");
  assert.match(ps1, /\$env:EDITOR = "nvim"/);
  assert.match(ps1, /function ll \{ ls -la @args \}/);
  assert.ok(report.notes.some((n) => n.includes("$PROFILE")));
});
