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
  /** Only trust `command` on these OSes (default: all). On Windows, `bash` is WSL's launcher, not Git Bash. */
  commandOn?: OS[];
  /** Fallback for GUI apps with no CLI: well-known install paths (env vars allowed). */
  paths?: Partial<Record<OS, string[]>>;
}

export type Category =
  | "Essentials" | "Languages" | "Editors & AI" | "Databases" | "Tools"
  // Project resources
  | "Frameworks" | "Database libraries" | "Auth";

/**
 * Where a resource lives.
 * - machine: installed once on the computer with the OS's installer (Git, Docker, VS Code).
 * - project: a dependency inside one project, added with its package manager (Hono, Kysely). Coming next.
 */
export type ResourceKind = "machine" | "project";

export interface CatalogItem {
  id: string;
  name: string;
  kind: ResourceKind;
  /** One line, shown by `dkit info`. */
  description: string;
  /** What `dkit migrate` saves and restores for it. Kept honest by a test against src/migrate. */
  snapshot?: string[];
  /** Project resources: the npm packages added to the project (`dev` = devDependencies). */
  packages?: {
    deps?: string[];
    dev?: string[];
    /** Packages that must match another's version: { prisma: "@prisma/client" } adds prisma@<client's version>. */
    sameVersion?: Record<string, string>;
  };
  /** Project resources that usually need one of these too (e.g. Kysely needs a database driver). */
  suggests?: { ids: string[]; what: string };
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
    kind: "machine",
    description: "Version control: track changes to your code and work with GitHub and other hosts.",
    snapshot: ["global config", "global gitignore"],
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
    kind: "machine",
    description: "A Bash shell for Windows that comes with Git. Claude Code uses it on Windows.",
    category: "Essentials",
    detect: {
      paths: { windows: ["%ProgramFiles%\\Git\\bin\\bash.exe", "%LOCALAPPDATA%\\Programs\\Git\\bin\\bash.exe"] },
      command: "bash",
      versionArgs: ["--version"],
      commandOn: ["macos", "linux"], // on Windows `bash` starts WSL (slow, and it's not Git Bash)
    },
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
    kind: "machine",
    description: "SSH client for connecting to servers and signing in to GitHub over SSH.",
    snapshot: ["SSH config (never keys)"],
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
    kind: "machine",
    description: "GitHub from the terminal: pull requests, issues, releases, and sign-in for Git.",
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
    kind: "machine",
    description: "JavaScript runtime with npm, the package manager most JS/TS tools install with.",
    snapshot: ["global npm packages"],
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
    kind: "machine",
    description: "Python 3 with pip, for scripts, data work and Python web frameworks.",
    category: "Languages",
    // On Windows, `python` can be a Microsoft Store stub that fails --version; that counts as missing.
    detect: { command: "python", versionArgs: ["--version"] },
    install: {
      windows: { type: "winget", id: "Python.Python.3.13" },
      macos: { type: "brew", formula: "python" },
      linux: { type: "apt", packages: ["python3", "python3-pip", "python3-venv"] },
    },
  },
  {
    id: "pnpm",
    name: "pnpm",
    kind: "machine",
    description: "Fast, disk-efficient package manager for Node.js projects.",
    category: "Languages",
    detect: { command: "pnpm", versionArgs: ["--version"] },
    install: npmGlobal("pnpm"),
    requires: { all: ["node"] },
  },
  {
    id: "yarn",
    name: "Yarn",
    kind: "machine",
    description: "Package manager for Node.js projects.",
    category: "Languages",
    detect: { command: "yarn", versionArgs: ["--version"] },
    install: npmGlobal("yarn"),
    requires: { all: ["node"] },
  },
  {
    id: "bun",
    name: "Bun",
    kind: "machine",
    description: "JavaScript runtime, package manager and test runner in one, a fast alternative to Node.js.",
    category: "Languages",
    detect: {
      command: "bun",
      versionArgs: ["--version"],
      paths: { windows: ["%USERPROFILE%\\.bun\\bin\\bun.exe"], macos: ["~/.bun/bin/bun"], linux: ["~/.bun/bin/bun"] },
    },
    install: {
      windows: { type: "winget", id: "Oven-sh.Bun" },
      macos: { type: "brew", tap: "oven-sh/bun", formula: "bun" },
      linux: { type: "script", shell: "bash", script: "curl -fsSL https://bun.sh/install | bash" },
    },
    notes: ["Open a new terminal so `bun` is on your PATH."],
  },

  // ── Editors & AI ────────────────────────────────────────────
  {
    id: "vscode",
    name: "Visual Studio Code",
    kind: "machine",
    description: "Microsoft's code editor, with extensions for almost every language.",
    snapshot: ["extensions", "settings", "keybindings", "tasks", "snippets"],
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
    kind: "machine",
    description: "Google's AI-first code editor, based on VS Code.",
    snapshot: ["extensions", "settings", "keybindings", "tasks", "snippets"],
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
    kind: "machine",
    description: "Anthropic's AI coding assistant that works in your terminal.",
    snapshot: ["settings", "CLAUDE.md", "keybindings", "commands", "agents", "skills", "output styles", "MCP servers"],
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
    kind: "machine",
    description: "OpenAI's AI coding assistant for the terminal.",
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
    kind: "machine",
    description: "Relational database server (version 17) with the psql client.",
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
    kind: "machine",
    description: "Graphical tool for managing PostgreSQL databases.",
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
    kind: "machine",
    description: "Document database server (MongoDB Community).",
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
    kind: "machine",
    description: "Graphical tool for browsing and querying MongoDB.",
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
    kind: "machine",
    description: "Runs apps in containers. On Windows this is Docker Desktop, which runs on WSL 2.",
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
    kind: "machine",
    description: "App for building and testing HTTP APIs.",
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
    kind: "machine",
    description: "Code formatter for JavaScript, TypeScript, CSS, JSON, Markdown and more.",
    category: "Tools",
    detect: { command: "prettier", versionArgs: ["--version"] },
    install: npmGlobal("prettier"),
    requires: { all: ["node"] },
    notes: ["Tip: most projects pin Prettier in package.json. The VS Code extension is esbenp.prettier-vscode."],
  },
  {
    id: "eslint",
    name: "ESLint",
    kind: "machine",
    description: "Linter that finds problems in JavaScript and TypeScript code.",
    category: "Tools",
    detect: { command: "eslint", versionArgs: ["--version"] },
    install: npmGlobal("eslint"),
    requires: { all: ["node"] },
    notes: ["Tip: most projects pin ESLint in package.json. The VS Code extension is dbaeumer.vscode-eslint."],
  },

  // ── Project resources: added to one project with its package manager ──
  {
    id: "hono",
    name: "Hono",
    kind: "project",
    description: "Small, fast web framework for APIs that runs on Node.js, Bun, Deno and edge platforms.",
    category: "Frameworks",
    detect: {},
    install: {},
    packages: { deps: ["hono"] },
  },
  {
    id: "express",
    name: "Express",
    kind: "project",
    description: "The classic minimal web framework for Node.js.",
    category: "Frameworks",
    detect: {},
    install: {},
    packages: { deps: ["express"], dev: ["@types/express"] },
  },
  {
    id: "better-auth",
    name: "Better Auth",
    kind: "project",
    description: "Authentication library for TypeScript: email/password, OAuth, sessions.",
    category: "Auth",
    detect: {},
    install: {},
    packages: { deps: ["better-auth"] },
    notes: ["Set BETTER_AUTH_SECRET and BETTER_AUTH_URL in your .env, then follow https://www.better-auth.com/docs/installation"],
  },
  {
    id: "kysely",
    name: "Kysely",
    kind: "project",
    description: "Type-safe SQL query builder for TypeScript.",
    category: "Database libraries",
    detect: {},
    install: {},
    packages: { deps: ["kysely"] },
    suggests: { ids: ["pg"], what: "a database driver" },
  },
  {
    id: "pg",
    name: "node-postgres (pg)",
    kind: "project",
    description: "PostgreSQL driver for Node.js, used by Kysely, Drizzle and others.",
    category: "Database libraries",
    detect: {},
    install: {},
    packages: { deps: ["pg"], dev: ["@types/pg"] },
    notes: ["Set DATABASE_URL, e.g. postgres://postgres:<password>@localhost:5432/<db>"],
  },
  {
    id: "drizzle",
    name: "Drizzle ORM",
    kind: "project",
    description: "TypeScript ORM with SQL-like queries, plus drizzle-kit for migrations.",
    category: "Database libraries",
    detect: {},
    install: {},
    packages: { deps: ["drizzle-orm"], dev: ["drizzle-kit"] },
    suggests: { ids: ["pg"], what: "a database driver" },
  },
  {
    id: "prisma",
    name: "Prisma",
    kind: "project",
    description: "TypeScript ORM with a schema file, generated client and migrations.",
    category: "Database libraries",
    detect: {},
    install: {},
    // The prisma CLI must match @prisma/client. (Its npm "latest" tag has pointed at a release candidate.)
    packages: { deps: ["@prisma/client"], dev: ["prisma"], sameVersion: { prisma: "@prisma/client" } },
    notes: ["Run `npx prisma init` to create the schema and .env."],
  },
  {
    id: "dbmate",
    name: "dbmate",
    kind: "project",
    description: "Plain-SQL database migrations that work with any language or framework.",
    category: "Database libraries",
    detect: {},
    install: {},
    packages: { dev: ["dbmate"] },
    notes: ["Set DATABASE_URL, then `npx dbmate new <name>` and `npx dbmate up`."],
  },
];

export const CATEGORIES: Category[] = ["Essentials", "Languages", "Editors & AI", "Databases", "Tools", "Frameworks", "Database libraries", "Auth"];

export function getItem(id: string): CatalogItem | undefined {
  return CATALOG.find((i) => i.id === id);
}

export function requiresFor(item: CatalogItem, os: OS): string[] {
  return [...(item.requires?.all ?? []), ...(item.requires?.[os] ?? [])];
}
