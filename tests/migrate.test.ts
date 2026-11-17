import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createBackup } from "../src/migrate/export.js";
import { restoreBackup, validateBackup, SECTIONS } from "../src/migrate/restore.js";
import { REDACTED, foreignPaths, redactJson, redactJsonc } from "../src/migrate/bundle.js";
import { editorUserDir } from "../src/core/platform.js";
import { silentLogger } from "../src/utils/logger.js";
import { engineCtx, fakeRunner, ok, tempPlatform } from "./helpers.js";

function put(file: string, content: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

/** An "old Windows PC" with VS Code, Git and Claude Code configured. */
function oldMachine() {
  const platform = tempPlatform("windows");
  const vs = editorUserDir(platform, "Code");
  put(path.join(vs, "settings.json"), `{\n  // my settings\n  "editor.fontSize": 15,\n  "github.token": "ghp_supersecretvalue",\n}`);
  put(path.join(vs, "snippets", "ts.json"), `{"log": {"prefix": "cl"}}`);
  put(path.join(platform.home, ".claude", "settings.json"), JSON.stringify({ model: "opus", env: { ANTHROPIC_API_KEY: "sk-ant-123", DEBUG: "1" } }));
  put(path.join(platform.home, ".claude", "commands", "review.md"), "Review this code");
  put(path.join(platform.home, ".claude", ".credentials.json"), "SHOULD NEVER LEAVE");
  put(path.join(platform.home, ".claude.json"), JSON.stringify({
    oauthAccount: { email: "x" },
    mcpServers: { files: { command: "npx", args: ["-y", "server-files"] }, gh: { command: "gh-mcp", env: { GITHUB_TOKEN: "ghp_x" } } },
  }));
  put(path.join(platform.home, ".gitignore_global"), "node_modules\n.env\n");
  put(path.join(platform.home, ".ssh", "id_ed25519"), "PRIVATE KEY");

  const { runner } = fakeRunner({
    installed: new Set(["git", "code", "node", "npm", "claude"]),
    responses: {
      "code --list-extensions": ok("esbenp.prettier-vscode\ndbaeumer.vscode-eslint"),
      "git config --global --list": ok(
        `user.name=Ikram\nuser.email=ikram@example.com\ncredential.helper=manager\ncore.excludesfile=${path.join(platform.home, ".gitignore_global")}\ncore.editor=C:\\\\Tools\\\\vim.exe`,
      ),
      "npm ls -g": ok(JSON.stringify({ dependencies: { npm: {}, typescript: {}, prettier: {} } })),
    },
  });
  return { platform, runner };
}

test("export: captures setup, removes secrets, never takes keys or logins", () => {
  const { platform, runner } = oldMachine();
  const b = createBackup({ runner, platform, log: silentLogger });

  assert.deepEqual(b.editors[0].extensions, ["esbenp.prettier-vscode", "dbaeumer.vscode-eslint"]);
  const settings = Buffer.from(b.editors[0].files.find((f) => f.path === "settings.json")!.base64, "base64").toString();
  assert.ok(settings.includes("// my settings") && settings.includes(REDACTED) && !settings.includes("ghp_"));

  const all = JSON.stringify(b);
  for (const secret of ["sk-ant-123", "SHOULD NEVER LEAVE", "PRIVATE KEY", "oauthAccount"]) assert.ok(!all.includes(secret), secret);

  assert.ok(b.claude.files.some((f) => f.path === "commands/review.md"));
  assert.ok(!b.git.config.some(([k]) => k.startsWith("credential.")));
  assert.ok(b.git.excludesFile);
  assert.deepEqual(b.npmGlobals, ["typescript"]); // prettier is a catalog tool, npm is built in
  assert.ok(b.tools.includes("git") && b.tools.includes("claude"));
});

test("restore Windows → Linux: writes files to Linux paths and backs up what it replaces", async () => {
  const { platform: oldP, runner: oldR } = oldMachine();
  const backup = validateBackup(JSON.parse(JSON.stringify(createBackup({ runner: oldR, platform: oldP, log: silentLogger }))));

  const target = tempPlatform("linux");
  const vs = editorUserDir(target, "Code");
  put(path.join(vs, "settings.json"), "{}"); // existing file on the new machine
  const { runner, calls } = fakeRunner({ installed: new Set(["git", "code", "npm", "claude"]) });
  const ctx = { ...engineCtx(runner, target), select: async (_m: string, ch: { value: string; checked?: boolean }[]) => ch.filter((c) => c.checked).map((c) => c.value), sections: [...SECTIONS].filter((s) => s !== "tools") };

  // Dry run changes nothing.
  await restoreBackup(backup, { ...ctx, dryRun: true });
  assert.equal(readFileSync(path.join(vs, "settings.json"), "utf8"), "{}");
  assert.ok(!existsSync(path.join(target.home, ".claude")));

  const report = await restoreBackup(backup, ctx);
  assert.ok(readFileSync(path.join(vs, "settings.json"), "utf8").includes("editor.fontSize"));
  assert.ok(readdirSync(vs).some((f) => f.startsWith("settings.json.dkit-backup-")), "old settings kept");
  assert.ok(existsSync(path.join(vs, "snippets", "ts.json")));
  assert.ok(existsSync(path.join(target.home, ".claude", "commands", "review.md")));
  assert.ok(calls.includes("code --install-extension esbenp.prettier-vscode --force"));
  assert.ok(calls.some((c) => c.startsWith("git config --global user.name Ikram")));
  assert.ok(!calls.some((c) => c.includes("core.editor")), "Windows-only editor path is not applied on Linux");
  assert.ok(report.notes.some((n) => n.includes("core.editor")));
  assert.ok(calls.some((c) => c.startsWith("claude mcp add-json files")));
  assert.ok(!calls.some((c) => c.startsWith("claude mcp add-json gh")), "server with a removed secret needs manual setup");
  assert.ok(calls.includes("npm install -g typescript"));
});

test("a damaged backup is refused", async () => {
  const { platform, runner } = oldMachine();
  const b = createBackup({ runner, platform, log: silentLogger });
  b.claude.files[0].base64 = Buffer.from("tampered").toString("base64");
  const target = tempPlatform("windows");
  const ctx = { ...engineCtx(fakeRunner({ installed: new Set() }).runner, target), select: async () => [], sections: ["claude" as const] };
  await assert.rejects(restoreBackup(b, ctx), /Checksum mismatch/);
});

test("export skips synced skills, trash and dkit's own backup copies", () => {
  const { platform, runner } = oldMachine();
  const skills = path.join(platform.home, ".claude", "skills");
  put(path.join(skills, "my-skill", "SKILL.md"), "mine");
  put(path.join(skills, "synced", "abc_123", "big-skill", "SKILL.md"), "synced from account");
  put(path.join(skills, "synced", ".bucket-abc_123"), "marker");
  put(path.join(skills, ".trash", "1793-xyz", "SKILL.md"), "deleted");
  put(path.join(platform.home, ".claude", "commands", "review.md.dkit-backup-2026-11-17T13-47-49"), "old copy");

  const paths = createBackup({ runner, platform, log: silentLogger }).claude.files.map((f) => f.path);
  assert.ok(paths.includes("skills/my-skill/SKILL.md"), "the user's own skill is kept");
  assert.ok(paths.includes("commands/review.md"));
  for (const p of paths) assert.ok(!/synced|\.trash|dkit-backup/.test(p), `should not export ${p}`);
});

test("restoring onto the same machine changes nothing", async () => {
  const { platform, runner } = oldMachine();
  // A settings file with no secrets, formatted the way Claude Code writes it (trailing newline, own spacing).
  const claudeSettings = path.join(platform.home, ".claude", "settings.json");
  const original = `{\n    "model": "opus",\n    "autoUpdatesChannel": "latest"\n}\n`;
  put(claudeSettings, original);

  const backup = validateBackup(JSON.parse(JSON.stringify(createBackup({ runner, platform, log: silentLogger }))));
  const ctx = { ...engineCtx(runner, platform), select: async () => [], sections: ["claude" as const] };
  const report = await restoreBackup(backup, { ...ctx, dryRun: true });

  assert.ok(!report.written.includes(claudeSettings), "unchanged settings.json is not rewritten");
  assert.deepEqual(report.backedUp, []);
  assert.equal(readFileSync(claudeSettings, "utf8"), original);
});

test("redaction helpers", () => {
  const r = redactJson({ a: { apiKey: "x", name: "ok" }, headers: { Authorization: "Bearer y" } });
  assert.deepEqual(r.value, { a: { apiKey: REDACTED, name: "ok" }, headers: { Authorization: REDACTED } });
  assert.match(redactJsonc(`"openai.apiKey": "sk-abcdef"`).text, /REDACTED/);
  assert.deepEqual(foreignPaths("path C:\\Users\\me\\x", "linux"), ["C:\\Users\\me\\x"]);
  assert.deepEqual(foreignPaths("path C:\\Users\\me\\x", "windows"), []);
});
