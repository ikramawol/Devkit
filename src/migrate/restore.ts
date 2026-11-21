import path from "node:path";
import { existsSync } from "node:fs";
import type { PlatformInfo } from "../core/platform.js";
import { editorUserDir } from "../core/platform.js";
import { getItem } from "../core/catalog.js";
import { installTools, type EngineContext } from "../core/engine.js";
import { runMethod } from "../adapters/methods.js";
import type { Select } from "../utils/prompt.js";
import { c } from "../utils/logger.js";
import { EDITORS } from "./editors.js";
import { NPM_NAME, listNpmGlobals, readGitConfig } from "../manifest/discover.js";
import { convertProfile, convertedProfileTarget, transformGit } from "./transform.js";
import {
  type Backup, type BundledFile, REDACTED, bundleFile, foreignPaths, unbundle, writeWithBackup,
} from "./bundle.js";

export const SECTIONS = ["tools", "apps", "editors", "git", "claude", "npm", "ssh", "shell"] as const;
export type Section = (typeof SECTIONS)[number];

export const SECTION_LABELS: Record<Section, string> = {
  tools: "Developer tools (Git, Node, Docker…)",
  apps: "Other apps found by winget",
  editors: "VS Code / Antigravity extensions and settings",
  git: "Git config",
  claude: "Claude Code settings, commands, agents, skills, MCP servers",
  npm: "Global npm packages",
  ssh: "SSH config (not keys)",
  shell: "Shell profile",
};

export interface RestoreContext extends EngineContext {
  select: Select;
  sections: Section[];
}

export interface RestoreReport {
  written: string[];
  backedUp: string[];
  notes: string[];
}


export function validateBackup(data: unknown): Backup {
  const b = data as Backup;
  if (!b || b.format !== "dkit-backup") throw new Error("This is not a dkit backup file.");
  if (b.version !== 1) throw new Error(`Unsupported backup version ${b.version}. Update dkit.`);
  return b;
}

/** Which sections have something in them, for the picker. */
export function availableSections(b: Backup, platform: PlatformInfo): Section[] {
  const has: Record<Section, boolean> = {
    tools: b.tools.length > 0,
    apps: b.extraApps.ids.length > 0 && platform.os === "windows",
    editors: b.editors.length > 0,
    git: b.git.config.length > 0 || !!b.git.excludesFile,
    claude: b.claude.files.length > 0 || Object.keys(b.claude.mcpServers).length > 0,
    npm: b.npmGlobals.length > 0,
    ssh: !!b.ssh.config,
    shell: b.shell.length > 0,
  };
  return SECTIONS.filter((s) => has[s]);
}

export async function restoreBackup(b: Backup, ctx: RestoreContext): Promise<RestoreReport> {
  const { runner, platform, log, dryRun } = ctx;
  const report: RestoreReport = { written: [], backedUp: [], notes: [] };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const want = (s: Section) => ctx.sections.includes(s);
  const crossOs = b.source.os !== platform.os;

  const write = (target: string, f: BundledFile, label: string) => {
    const buf = unbundle(f); // throws on checksum mismatch
    const outcome = writeWithBackup(target, buf, stamp, dryRun);
    if (outcome === "unchanged") return;
    const verb = dryRun ? (outcome === "created" ? "would create" : "would replace") : outcome;
    log.info(`  ${c.dim(verb)} ${target}`);
    report.written.push(target);
    if (outcome === "replaced") report.backedUp.push(target);
    const odd = foreignPaths(buf.toString("utf8"), platform.os);
    if (odd.length) report.notes.push(`${label} mentions paths from your old ${b.source.os} machine (${odd.join(", ")}). Check them.`);
  };

  // ── Tools ────────────────────────────────────────────────
  if (want("tools")) {
    log.info(c.bold("\nTools"));
    const usable = b.tools.filter((id) => getItem(id)?.install[platform.os]);
    const chosen = await ctx.select(
      "Which tools should be installed on this machine?",
      usable.map((id) => ({ value: id, name: getItem(id)!.name, checked: true })),
    );
    if (chosen.length) await installTools(chosen, ctx);
  }

  // ── Other apps (Windows → Windows) ───────────────────────
  if (want("apps")) {
    log.info(c.bold("\nOther apps"));
    if (b.source.os !== "windows" || platform.os !== "windows") {
      report.notes.push(`${b.extraApps.ids.length} other apps were recorded on ${b.source.os}; they can only be reinstalled automatically on Windows.`);
    } else {
      // Nothing preselected: these can be games, drivers, anything.
      const chosen = await ctx.select(
        "Pick other apps to reinstall (none are selected by default)",
        b.extraApps.ids.map((id) => ({ value: id, name: id, checked: false })),
      );
      for (const id of chosen) {
        if (dryRun) { log.info(`  would run: winget install --id ${id}`); continue; }
        log.step(`Installing ${id}`);
        const r = runMethod({ type: "winget", id }, runner);
        r.ok ? log.ok(id) : log.error(`${id}: ${r.message}`);
      }
    }
  }

  // ── Editors ──────────────────────────────────────────────
  if (want("editors")) {
    runner.refreshPath(); // an editor may have just been installed
    for (const eb of b.editors) {
      const def = EDITORS.find((e) => e.id === eb.id);
      if (!def) continue;
      log.info(c.bold(`\n${eb.name}`));
      const userDir = editorUserDir(platform, def.dirName);

      if (runner.which(def.cli)) {
        const have = new Set(
          runner.run(def.cli, ["--list-extensions"]).stdout.split(/\r?\n/).map((s) => s.trim().toLowerCase()),
        );
        const missing = eb.extensions.filter((e) => !have.has(e.toLowerCase()));
        log.info(`  ${eb.extensions.length - missing.length} extensions already installed, ${missing.length} to add`);
        for (const ext of missing) {
          if (dryRun) { log.info(`  ${c.dim("would install")} ${ext}`); continue; }
          const r = runner.run(def.cli, ["--install-extension", ext, "--force"]);
          r.ok ? log.ok(ext) : log.warn(`${ext}: could not install (it may not exist for ${platform.os})`);
        }
      } else if (eb.extensions.length) {
        report.notes.push(`${eb.name} is not installed (or \`${def.cli}\` isn't on PATH): ${eb.extensions.length} extensions were not installed. Re-run restore with --only editors after installing it.`);
      }
      for (const f of eb.files) write(path.join(userDir, ...f.path.split("/")), f, `${eb.name} ${f.path}`);
    }
  }

  // ── Git ──────────────────────────────────────────────────
  if (want("git")) {
    log.info(c.bold("\nGit"));
    runner.refreshPath();
    if (!runner.which("git")) {
      report.notes.push("Git is not installed, so Git config was not restored.");
    } else {
      const grouped = new Map<string, string[]>();
      for (const [k, v] of b.git.config) grouped.set(k, [...(grouped.get(k) ?? []), v]);
      // What's already set here, so identical settings are left alone (and not listed as changes).
      const current = new Map<string, string[]>();
      for (const [k, v] of readGitConfig(runner) ?? []) current.set(k.toLowerCase(), [...(current.get(k.toLowerCase()) ?? []), v]);
      let applied = 0;
      for (const [key, original] of grouped) {
        // Settings that mean something else on this OS (line endings, Windows-only editors).
        const t = transformGit(key, original, b.source.os, platform.os);
        if (t.note) report.notes.push(t.note);
        if (!t.values) continue;
        const values = t.values;
        if (current.get(key.toLowerCase())?.join("\n") === values.join("\n")) continue;
        const odd = values.flatMap((v) => foreignPaths(v, platform.os));
        if (crossOs && odd.length) {
          report.notes.push(`Git ${key} = ${values[0]} points to your old machine; set it again for this one.`);
          continue;
        }
        applied++;
        if (dryRun) { log.info(`  ${c.dim("would set")} ${key} = ${values.join(", ")}`); continue; }
        if (values.length === 1) runner.run("git", ["config", "--global", key, values[0]]);
        else {
          runner.run("git", ["config", "--global", "--unset-all", key]);
          for (const v of values) runner.run("git", ["config", "--global", "--add", key, v]);
        }
      }
      if (b.git.excludesFile) {
        const target = path.join(platform.home, ".gitignore_global");
        write(target, b.git.excludesFile, "global gitignore");
        if (!dryRun) runner.run("git", ["config", "--global", "core.excludesfile", target.split(path.sep).join("/")]);
      }
      if (!applied) log.ok("Git settings already match");
      else if (!dryRun) log.ok(`${applied} Git setting(s) applied`);
    }
  }

  // ── Claude Code ──────────────────────────────────────────
  if (want("claude")) {
    log.info(c.bold("\nClaude Code"));
    const dir = path.join(platform.home, ".claude");
    for (const f of b.claude.files) write(path.join(dir, ...f.path.split("/")), f, `Claude ${f.path}`);

    const servers = Object.entries(b.claude.mcpServers);
    if (servers.length) {
      runner.refreshPath();
      const claude = runner.which("claude") ?? (existsSync(path.join(platform.claudeBinDir, "claude.exe")) ? path.join(platform.claudeBinDir, "claude.exe") : null);
      for (const [name, cfg] of servers) {
        const json = JSON.stringify(cfg);
        if (json.includes(REDACTED)) {
          report.notes.push(`MCP server "${name}" needs its secrets. Add it with: claude mcp add-json ${name} '<json>' --scope user`);
          continue;
        }
        // Unescape JSON's \\ so paths read as you'd type them (C:\Tools\mcp.exe).
        const odd = crossOs ? foreignPaths(json.replace(/\\\\/g, "\\"), platform.os) : [];
        if (odd.length) {
          report.notes.push(`MCP server "${name}" runs a program from your old ${b.source.os} machine (${odd.join(", ")}), so it wasn't added. Add it again for ${platform.os} with \`claude mcp add\`.`);
          continue;
        }
        if (!claude) { report.notes.push(`MCP server "${name}" not added: Claude Code isn't installed.`); continue; }
        if (dryRun) { log.info(`  ${c.dim("would add MCP server")} ${name}`); continue; }
        try {
          const r = runner.run(claude, ["mcp", "add-json", name, json, "--scope", "user"]);
          r.ok ? log.ok(`MCP server ${name}`) : log.warn(`MCP server ${name}: ${r.stderr || "could not add (it may already exist)"}`);
        } catch {
          report.notes.push(`MCP server "${name}": add it with: claude mcp add-json ${name} '${json}' --scope user`);
        }
      }
    }
    report.notes.push("Claude Code: run `claude` and sign in again (logins are never copied).");
  }

  // ── npm globals ──────────────────────────────────────────
  if (want("npm")) {
    log.info(c.bold("\nGlobal npm packages"));
    runner.refreshPath();
    const have = listNpmGlobals(runner, platform);
    if (!have) report.notes.push("npm is not installed, so global npm packages were skipped.");
    else {
      const missing = b.npmGlobals.filter((n) => NPM_NAME.test(n) && !have.includes(n));
      if (!missing.length) log.ok("all present");
      else if (dryRun) log.info(`  ${c.dim("would run")} npm install -g ${missing.join(" ")}`);
      else {
        const res = runner.run("npm", ["install", "-g", ...missing], { inherit: true });
        res.ok ? log.ok(missing.join(", ")) : log.error("npm install -g failed");
      }
    }
  }

  // ── SSH config ───────────────────────────────────────────
  if (want("ssh") && b.ssh.config) {
    log.info(c.bold("\nSSH"));
    write(path.join(platform.home, ".ssh", "config"), b.ssh.config, "SSH config");
  }

  // ── Shell profile ────────────────────────────────────────
  if (want("shell")) {
    log.info(c.bold("\nShell profile"));
    const fitsHere = (k: string) => (platform.os === "windows" ? k === "powershell" : k !== "powershell");

    // Profiles for another OS's shell: convert what can be converted into one file next to your own profile.
    const foreign = b.shell.filter((s) => !fitsHere(s.kind));
    if (foreign.length) {
      const parts = foreign.map((s) => convertProfile(unbundle(s.file).toString("utf8"), s.kind, s.file.path));
      const converted = parts.reduce((n, p) => n + p.converted, 0);
      const kinds = [...new Set(foreign.map((s) => s.kind))].join(" and ");
      if (!converted) {
        report.notes.push(`Your ${kinds} profile doesn't run on ${platform.os}, and had nothing dkit could convert. It's in the backup if you want to translate it by hand.`);
      } else {
        const { file, howToLoad } = convertedProfileTarget(platform.home, platform.os, path.join);
        const text = parts.map((p) => p.text).join("\n");
        write(file, bundleFile("profile", Buffer.from(text, "utf8")), "converted shell profile");
        const left = parts.reduce((n, p) => n + p.skipped, 0);
        report.notes.push(`Your ${kinds} profile doesn't run on ${platform.os}: dkit converted ${converted} environment variable(s)/alias(es) into ${file}${left ? ` (${left} line(s) left out)` : ""}. To use it, ${howToLoad}`);
        if (text.includes(REDACTED)) report.notes.push(`${file} has secrets shown as ${REDACTED}: fill them in.`);
      }
    }

    for (const s of b.shell) {
      if (!fitsHere(s.kind)) continue;
      const target = path.join(platform.home, ...s.file.path.split("/"));
      write(target, s.file, `${s.kind} profile`);
      if (unbundle(s.file).toString("utf8").includes(REDACTED))
        report.notes.push(`Your ${s.kind} profile (${target}) had secret values removed. Search it for ${REDACTED} and fill them in, or those variables will be wrong.`);
    }
  }

  report.notes.push(...b.notes);
  return report;
}
