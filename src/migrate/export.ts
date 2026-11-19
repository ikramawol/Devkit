import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Runner } from "../utils/run.js";
import type { Logger } from "../utils/logger.js";
import type { PlatformInfo } from "../core/platform.js";
import { editorUserDir } from "../core/platform.js";
import { CATALOG } from "../core/catalog.js";
import { detectItem } from "../core/detect.js";
import { EDITORS, EDITOR_DIRS, EDITOR_FILES } from "./editors.js";
import {
  type Backup, type BundledFile, bundleFile, collectDir, redactJson, redactJsonc, redactShell,
} from "./bundle.js";

export interface ExportDeps {
  runner: Runner;
  platform: PlatformInfo;
  log: Logger;
  exists?: (p: string) => boolean;
}

const read = (p: string) => (existsSync(p) ? readFileSync(p) : null);

// Git keys that hold secrets or machine-specific helpers. Re-created per machine instead.
const SKIP_GIT_KEY = /^(credential\.|http\..*extraheader|.*(token|password))/i;

// What we take from ~/.claude. Sessions, history, caches and credentials stay behind.
const CLAUDE_FILES = ["settings.json", "CLAUDE.md", "keybindings.json"];
const CLAUDE_DIRS = ["commands", "agents", "skills", "output-styles"];
// Inside those: skills Claude syncs from your account by itself (it re-downloads them after sign-in).
const CLAUDE_SKIP: Record<string, string[]> = { skills: ["synced"] };

export function createBackup(deps: ExportDeps): Backup {
  const { runner, platform, log } = deps;
  const notes: string[] = [];

  // 1. Tools from the catalog.
  log.step("Checking installed tools");
  // Machine tools only: project libraries live in each project's package.json, not on the machine.
  const tools = CATALOG.filter((i) => i.kind === "machine" && detectItem(i, deps).installed).map((i) => i.id);
  log.ok(`${tools.length} tools: ${tools.join(", ")}`);

  // 2. Other apps (Windows): everything winget can see, minus what the catalog covers.
  const extraApps: Backup["extraApps"] = { source: "winget", ids: [] };
  if (platform.os === "windows" && runner.which("winget")) {
    log.step("Listing other apps with winget");
    const dir = mkdtempSync(path.join(os.tmpdir(), "dkit-"));
    const file = path.join(dir, "winget.json");
    const r = runner.run("winget", ["export", "-o", file, "--accept-source-agreements", "--disable-interactivity"]);
    if (existsSync(file)) {
      try {
        const data = JSON.parse(readFileSync(file, "utf8"));
        const known = new Set(CATALOG.map((i) => (i.install.windows?.type === "winget" ? i.install.windows.id : "")));
        for (const src of data.Sources ?? [])
          for (const p of src.Packages ?? [])
            if (p.PackageIdentifier && !known.has(p.PackageIdentifier)) extraApps.ids.push(p.PackageIdentifier);
        log.ok(`${extraApps.ids.length} other apps recorded`);
      } catch {
        log.warn("Could not read winget's export");
      }
    } else if (!r.ok) log.warn("winget export failed; other apps were not recorded");
    rmSync(dir, { recursive: true, force: true });
  }

  // 3. Editors: extensions and user settings.
  const editors: Backup["editors"] = [];
  for (const ed of EDITORS) {
    const userDir = editorUserDir(platform, ed.dirName);
    const hasCli = !!runner.which(ed.cli);
    if (!hasCli && !existsSync(userDir)) continue;
    log.step(`Reading ${ed.name}`);
    const extensions = hasCli
      ? runner.run(ed.cli, ["--list-extensions"]).stdout.split(/\r?\n/).map((s) => s.trim()).filter((s) => /^[\w-]+\.[\w.-]+$/.test(s))
      : [];
    if (!hasCli) notes.push(`${ed.name}: \`${ed.cli}\` command not found, so extensions were not recorded.`);

    const files: BundledFile[] = [];
    for (const f of EDITOR_FILES) {
      const buf = read(path.join(userDir, f));
      if (!buf) continue;
      const { text, redacted } = redactJsonc(buf.toString("utf8"));
      if (redacted.length) notes.push(`${ed.name} ${f}: removed secret values (${redacted.join(", ")}). Re-enter them after restore.`);
      files.push(bundleFile(f, Buffer.from(text, "utf8")));
    }
    for (const d of EDITOR_DIRS) files.push(...collectDir(path.join(userDir, d), d));
    editors.push({ id: ed.id, name: ed.name, extensions, files });
    log.ok(`${ed.name}: ${extensions.length} extensions, ${files.length} settings files`);
  }

  // 4. Git global config.
  const git: Backup["git"] = { config: [] };
  if (runner.which("git")) {
    log.step("Reading Git config");
    const r = runner.run("git", ["config", "--global", "--list"]);
    for (const line of r.stdout.split(/\r?\n/)) {
      const i = line.indexOf("=");
      if (i <= 0) continue;
      const key = line.slice(0, i);
      const value = line.slice(i + 1);
      if (SKIP_GIT_KEY.test(key)) continue;
      if (key === "core.excludesfile") {
        const p = value.replace(/^~/, platform.home);
        const buf = read(p);
        if (buf) git.excludesFile = bundleFile(".gitignore_global", buf);
        continue; // the path is rewritten on restore
      }
      git.config.push([key, value]);
    }
    log.ok(`${git.config.length} Git settings`);
  }

  // 5. Claude Code: settings, memory, commands, agents, skills, user-level MCP servers.
  const claude: Backup["claude"] = { files: [], mcpServers: {} };
  const claudeDir = path.join(platform.home, ".claude");
  if (existsSync(claudeDir)) {
    log.step("Reading Claude Code config");
    for (const f of CLAUDE_FILES) {
      const buf = read(path.join(claudeDir, f));
      if (!buf) continue;
      if (f.endsWith(".json")) {
        try {
          const { value, redacted } = redactJson(JSON.parse(buf.toString("utf8")));
          if (redacted.length) {
            notes.push(`Claude ${f}: removed secret values (${redacted.join(", ")}).`);
            claude.files.push(bundleFile(f, Buffer.from(JSON.stringify(value, null, 2) + "\n", "utf8")));
            continue;
          }
          // Nothing secret: keep the exact bytes so an unchanged file restores as "unchanged".
        } catch { /* not valid JSON: carry as-is */ }
      }
      claude.files.push(bundleFile(f, buf));
    }
    for (const d of CLAUDE_DIRS) claude.files.push(...collectDir(path.join(claudeDir, d), d, undefined, CLAUDE_SKIP[d]));

    const cfg = read(path.join(platform.home, ".claude.json"));
    if (cfg) {
      try {
        const servers = JSON.parse(cfg.toString("utf8")).mcpServers ?? {};
        const { value, redacted } = redactJson(servers);
        claude.mcpServers = value as Record<string, unknown>;
        if (redacted.length) notes.push(`MCP servers: removed secret values (${redacted.join(", ")}). Fill them in with \`claude mcp\` after restore.`);
      } catch { /* ignore */ }
    }
    log.ok(`Claude Code: ${claude.files.length} files, ${Object.keys(claude.mcpServers).length} MCP servers`);
  }

  // 6. Global npm packages (other than ones the catalog installs).
  let npmGlobals: string[] = [];
  if (runner.which("npm")) {
    const r = runner.run("npm", ["ls", "-g", "--depth=0", "--json"]);
    try {
      const catalogPkgs = new Set(CATALOG.map((i) => (i.install.windows?.type === "npm" ? i.install.windows.pkg : "")));
      npmGlobals = Object.keys(JSON.parse(r.stdout).dependencies ?? {}).filter(
        (n) => !["npm", "corepack"].includes(n) && !catalogPkgs.has(n),
      );
      log.ok(`${npmGlobals.length} global npm packages`);
    } catch { /* ignore */ }
  }

  // 7. SSH config (never keys) and shell profile.
  const ssh: Backup["ssh"] = {};
  const sshCfg = read(path.join(platform.home, ".ssh", "config"));
  if (sshCfg) ssh.config = bundleFile("config", sshCfg);
  notes.push("SSH private keys were NOT exported. Copy them yourself or create new ones and add them to GitHub.");

  const shell: Backup["shell"] = [];
  const shellCandidates: [Backup["shell"][number]["kind"], string][] =
    platform.os === "windows"
      ? [
          ["powershell", path.join(platform.home, "Documents", "PowerShell", "Microsoft.PowerShell_profile.ps1")],
          ["powershell", path.join(platform.home, "Documents", "WindowsPowerShell", "Microsoft.PowerShell_profile.ps1")],
        ]
      : [["bash", path.join(platform.home, ".bashrc")], ["zsh", path.join(platform.home, ".zshrc")]];
  for (const [kind, p] of shellCandidates) {
    const buf = read(p);
    if (!buf) continue;
    const rel = path.relative(platform.home, p);
    const { text, redacted } = redactShell(buf.toString("utf8"));
    if (redacted.length) notes.push(`${kind} profile (${rel}): removed secret values (${redacted.join(", ")}). Fill them in after restore.`);
    // Nothing secret: keep the exact bytes so an unchanged file restores as "unchanged".
    shell.push({ kind, file: bundleFile(rel, redacted.length ? Buffer.from(text, "utf8") : buf) });
  }

  return {
    format: "dkit-backup",
    version: 1,
    createdAt: new Date().toISOString(),
    source: { os: platform.os, hostname: platform.hostname },
    tools,
    extraApps,
    editors,
    git,
    claude,
    npmGlobals,
    ssh,
    shell,
    notes,
  };
}
