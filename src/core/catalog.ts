import type { OS } from "./platform.js";
import type { Prereq } from "./prereqs.js";

/** How to install one tool on one OS. */
export type Method =
  | { type: "winget"; id: string }
  | { type: "brew"; formula?: string; cask?: string; tap?: string }
  | { type: "apt"; packages: string[] }
  | { type: "npm"; pkg: string }
  | { type: "script"; shell: "powershell" | "bash"; script: string }
  /** Windows optional feature that needs admin (shows a UAC prompt). */
  | { type: "windows-capability"; name: string }
  /** Installed by another catalog item (e.g. Git Bash comes with Git for Windows). */
  | { type: "bundled"; with: string }
  /** Already part of the OS. */
  | { type: "builtin" }
  /** No reliable automatic installer: tell the user where to get it. */
  | { type: "manual"; url: string };

export interface Detect {
  /** Command on PATH; `versionArgs` must succeed for the tool to count as installed. */
  command?: string;
  versionArgs?: string[];
  /** Fallback for GUI apps with no CLI: well-known install paths (env vars allowed). */
  paths?: Partial<Record<OS, string[]>>;
}

export type Category = "Essentials" | "Languages" | "Editors & AI" | "Databases" | "Tools";

export interface CatalogItem {
  id: string;
  name: string;
  category: Category;
  detect: Detect;
  install: Partial<Record<OS, Method>>;
  /** Other catalog ids that must be installed first. */
  requires?: Partial<Record<OS, string[]>> & { all?: string[] };
  /** OS setup that must be in place first (Windows features, WSL, ...). Checked by `doctor`, set up by `install`. */
  prereqs?: Partial<Record<OS, Prereq[]>>;
  /** Shown after install: logins, restarts, passwords. */
  notes?: string[];
}

const npmGlobal = (pkg: string) => ({ windows: { type: "npm", pkg }, macos: { type: "npm", pkg }, linux: { type: "npm", pkg } }) as const;

export const CATALOG: CatalogItem[] = [
  // ── Essentials ──────────────────────────────────────────────
  {
    id: "git",
    name: "Git",
    category: "Essentials",
    detect: { command: "git", versionArgs: ["--version"] },
    install: {
      windows: { type: "winget", id: "Git.Git" },
      macos: { type: "brew", formula: "git" },
      linux: { type: "apt", packages: ["git"] },
    },
  },
  {
    id: "git-bash",
    name: "Git Bash",
    category: "Essentials",
    detect: { paths: { windows: ["%ProgramFiles%\\Git\\bin\\bash.exe", "%LOCALAPPDATA%\\Programs\\Git\\bin\\bash.exe"] }, command: "bash", versionArgs: ["--version"] },
    install: {
      windows: { type: "bundled", with: "git" },
      macos: { type: "builtin" },
      linux: { type: "builtin" },
    },
    requires: { windows: ["git"] },
  },
  {
    id: "openssh",
    name: "OpenSSH",
    category: "Essentials",
    detect: { command: "ssh", versionArgs: ["-V"] },
    install: {
      windows: { type: "windows-capability", name: "OpenSSH.Client~~~~0.0.1.0" },
      macos: { type: "builtin" },
      linux: { type: "apt", packages: ["openssh-client"] },
    },
    notes: ["SSH keys are never copied automatically. Create new ones (ssh-keygen -t ed25519) or copy them yourself."],
  },
  {
    id: "gh",
    name: "GitHub CLI",
    category: "Essentials",
    detect: { command: "gh", versionArgs: ["--version"] },
    install: {
      windows: { type: "winget", id: "GitHub.cli" },
      macos: { type: "brew", formula: "gh" },
      linux: { type: "apt", packages: ["gh"] },
    },
    notes: ["Sign in with: gh auth login"],
  },

  // ── Languages ───────────────────────────────────────────────
  {
    id: "node",
    name: "Node.js + npm",
    category: "Languages",
    detect: { command: "node", versionArgs: ["--version"] },
    install: {
      windows: { type: "winget", id: "OpenJS.NodeJS.LTS" },
      macos: { type: "brew", formula: "node" },
      linux: { type: "apt", packages: ["nodejs", "npm"] },
    },
  },
  {
    id: "python",
    name: "Python",
    category: "Languages",
    // On Windows, `python` can be a Microsoft Store stub that fails --version; that counts as missing.
    detect: { command: "python", versionArgs: ["--version"] },
    install: {
      windows: { type: "winget", id: "Python.Python.3.13" },
      macos: { type: "brew", formula: "python" },
      linux: { type: "apt", packages: ["python3", "python3-pip", "python3-venv"] },
    },
  },

  // ── Editors & AI ────────────────────────────────────────────
  {
    id: "vscode",
    name: "Visual Studio Code",
    category: "Editors & AI",
    detect: {
      command: "code",
      versionArgs: ["--version"],
      paths: { windows: ["%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe", "%ProgramFiles%\\Microsoft VS Code\\Code.exe"], macos: ["/Applications/Visual Studio Code.app"] },
    },
    install: {
      windows: { type: "winget", id: "Microsoft.VisualStudioCode" },
      macos: { type: "brew", cask: "visual-studio-code" },
      linux: { type: "manual", url: "https://code.visualstudio.com/download" },
    },
  },
  {
    id: "antigravity",
    name: "Antigravity",
    category: "Editors & AI",
    detect: {
      command: "antigravity",
      versionArgs: ["--version"],
      paths: { windows: ["%LOCALAPPDATA%\\Programs\\Antigravity\\Antigravity.exe"], macos: ["/Applications/Antigravity.app"] },
    },
    install: {
      windows: { type: "winget", id: "Google.Antigravity" },
      macos: { type: "manual", url: "https://antigravity.google/download" },
      linux: { type: "manual", url: "https://antigravity.google/download" },
    },
    notes: ["Open Antigravity and sign in with your Google account."],
  },
  {
    id: "claude",
    name: "Claude Code",
    category: "Editors & AI",
    detect: { command: "claude", versionArgs: ["--version"], paths: { windows: ["%USERPROFILE%\\.local\\bin\\claude.exe"], macos: ["~/.local/bin/claude"], linux: ["~/.local/bin/claude"] } },
    install: {
      windows: { type: "script", shell: "powershell", script: "irm https://claude.ai/install.ps1 | iex" },
      macos: { type: "script", shell: "bash", script: "curl -fsSL https://claude.ai/install.sh | bash" },
      linux: { type: "script", shell: "bash", script: "curl -fsSL https://claude.ai/install.sh | bash" },
    },
    requires: { windows: ["git"] }, // Claude Code on Windows runs on Git Bash
    notes: ["Open a new terminal, run `claude` and sign in."],
  },
  {
    id: "codex",
    name: "Codex CLI",
    category: "Editors & AI",
    detect: { command: "codex", versionArgs: ["--version"] },
    install: npmGlobal("@openai/codex"),
    requires: { all: ["node"] },
    notes: ["Run `codex` and sign in with your ChatGPT account or an API key."],
  },

  // ── Databases ───────────────────────────────────────────────
  {
    id: "postgresql",
    name: "PostgreSQL",
    category: "Databases",
    detect: { command: "psql", versionArgs: ["--version"], paths: { windows: ["%ProgramFiles%\\PostgreSQL\\17\\bin\\psql.exe"] } },
    install: {
      windows: { type: "winget", id: "PostgreSQL.PostgreSQL.17" },
      macos: { type: "brew", formula: "postgresql@17" },
      linux: { type: "apt", packages: ["postgresql"] },
    },
    notes: ["Set or check the `postgres` user's password before using it. Data is NOT migrated: use pg_dump."],
  },
  {
    id: "pgadmin",
    name: "pgAdmin",
    category: "Databases",
    detect: { paths: { windows: ["%ProgramFiles%\\pgAdmin 4\\runtime\\pgAdmin4.exe", "%LOCALAPPDATA%\\Programs\\pgAdmin 4\\runtime\\pgAdmin4.exe"], macos: ["/Applications/pgAdmin 4.app"] } },
    install: {
      windows: { type: "winget", id: "PostgreSQL.pgAdmin" },
      macos: { type: "brew", cask: "pgadmin4" },
      linux: { type: "manual", url: "https://www.pgadmin.org/download/" },
    },
  },
  {
    id: "mongodb",
    name: "MongoDB",
    category: "Databases",
    detect: { command: "mongod", versionArgs: ["--version"], paths: { windows: ["%ProgramFiles%\\MongoDB\\Server"] } },
    install: {
      windows: { type: "winget", id: "MongoDB.Server" },
      macos: { type: "brew", tap: "mongodb/brew", formula: "mongodb-community" },
      linux: { type: "manual", url: "https://www.mongodb.com/docs/manual/administration/install-on-linux/" },
    },
    notes: ["Data is NOT migrated: use mongodump / mongorestore."],
  },
  {
    id: "compass",
    name: "MongoDB Compass",
    category: "Databases",
    detect: { paths: { windows: ["%LOCALAPPDATA%\\MongoDBCompass\\MongoDBCompass.exe", "%ProgramFiles%\\MongoDB Compass\\MongoDBCompass.exe"], macos: ["/Applications/MongoDB Compass.app"] } },
    install: {
      windows: { type: "winget", id: "MongoDB.Compass.Full" },
      macos: { type: "brew", cask: "mongodb-compass" },
      linux: { type: "manual", url: "https://www.mongodb.com/try/download/compass" },
    },
  },

  // ── Tools ───────────────────────────────────────────────────
  {
    id: "docker",
    name: "Docker",
    category: "Tools",
    detect: { command: "docker", versionArgs: ["--version"], paths: { windows: ["%ProgramFiles%\\Docker\\Docker\\Docker Desktop.exe"], macos: ["/Applications/Docker.app"] } },
    install: {
      windows: { type: "winget", id: "Docker.DockerDesktop" },
      macos: { type: "brew", cask: "docker-desktop" },
      linux: { type: "apt", packages: ["docker.io"] },
    },
    prereqs: {
      windows: [
        { type: "windows-build", min: 19045 },
        { type: "virtualization" },
        { type: "windows-feature", name: "VirtualMachinePlatform", label: "Virtual Machine Platform" },
        { type: "windows-feature", name: "Microsoft-Windows-Subsystem-Linux", label: "Windows Subsystem for Linux" },
        { type: "wsl" },
      ],
    },
    notes: ["Open Docker Desktop once to finish setup. If `docker` says permission denied, sign out and back in."],
  },
  {
    id: "postman",
    name: "Postman",
    category: "Tools",
    detect: { paths: { windows: ["%LOCALAPPDATA%\\Postman\\Postman.exe"], macos: ["/Applications/Postman.app"] } },
    install: {
      windows: { type: "winget", id: "Postman.Postman" },
      macos: { type: "brew", cask: "postman" },
      linux: { type: "manual", url: "https://www.postman.com/downloads/" },
    },
    notes: ["Sign in to Postman to sync your collections."],
  },
  {
    id: "prettier",
    name: "Prettier",
    category: "Tools",
    detect: { command: "prettier", versionArgs: ["--version"] },
    install: npmGlobal("prettier"),
    requires: { all: ["node"] },
    notes: ["Tip: most projects pin Prettier in package.json. The VS Code extension is esbenp.prettier-vscode."],
  },
  {
    id: "eslint",
    name: "ESLint",
    category: "Tools",
    detect: { command: "eslint", versionArgs: ["--version"] },
    install: npmGlobal("eslint"),
    requires: { all: ["node"] },
    notes: ["Tip: most projects pin ESLint in package.json. The VS Code extension is dbaeumer.vscode-eslint."],
  },
];

export const CATEGORIES: Category[] = ["Essentials", "Languages", "Editors & AI", "Databases", "Tools"];

export function getItem(id: string): CatalogItem | undefined {
  return CATALOG.find((i) => i.id === id);
}

export function requiresFor(item: CatalogItem, os: OS): string[] {
  return [...(item.requires?.all ?? []), ...(item.requires?.[os] ?? [])];
}
