import type { OS, PlatformInfo } from "./platform.js";
import type { Prereq } from "./prereqs.js";

/** How to install one tool on one OS. */
export type Method =
  /** `also`: other winget ids that are the same tool (Node.js installed as OpenJS.NodeJS.24 instead of .LTS). */
  | { type: "winget"; id: string; also?: string[] }
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
  /** A different command name on some OSes (Python is `python3` on macOS and Linux). */
  commandFor?: Partial<Record<OS, string>>;
  /**
   * Inside WSL, Windows programs are on PATH too (/mnt/c/...). They don't count as Linux tools,
   * except editors like VS Code, which are meant to be used from Windows (`code .` opens WSL folders).
   */
  windowsSideInWsl?: boolean;
  /** Fallback for GUI apps with no CLI: well-known install paths (env vars allowed). */
  paths?: Partial<Record<OS, string[]>>;
}

export type Category =
  | "Essentials" | "Languages" | "Editors & AI" | "Databases" | "Tools"
  // Project resources
  | "Frameworks" | "Database libraries" | "Auth" | "Payments & email" | "App architecture";

/** What kind of project a library goes into: JavaScript (package.json), Python, Go or Flutter. */
export type Ecosystem = "node" | "python" | "go" | "flutter";

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
  /** Project resources: the packages added to the project (`dev` = devDependencies). */
  packages?: {
    /** Default "node" (npm packages). Python: pip packages; Go: module paths; Flutter: pub packages. */
    ecosystem?: Ecosystem;
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
  /** Used instead of install.linux inside WSL, when the Linux way would clash with the Windows side (Docker Desktop). */
  wslInstall?: Method;
  /** Other catalog ids that must be installed first. */
  requires?: Partial<Record<OS, string[]>> & { all?: string[] };
  /** OS setup that must be in place first (Windows features, WSL, ...). Checked by `doctor`, set up by `install`. */
  prereqs?: Partial<Record<OS, Prereq[]>>;
  /** Shown after install: logins, restarts, passwords. */
  notes?: string[];
  /** An npm package some people install it with instead (older Claude Code installs). dkit then updates and removes it with npm. */
  npmAlt?: string;
  /** For script installs: the tool's own update command, e.g. ["claude", "update"]. Fixed, never from user input. */
  selfUpdate?: string[];
  /** For script installs: how to remove it by hand (dkit doesn't delete files for you). */
  removeManually?: Partial<Record<OS, string>>;
  /** Why dkit refuses to uninstall it on this OS (the system itself needs it). */
  keepOn?: Partial<Record<OS, string>>;
}

/** The installer dkit uses for this tool here. In WSL some tools come from Windows instead (Docker Desktop). */
export function methodFor(item: CatalogItem, platform: PlatformInfo): Method | undefined {
  return (platform.wsl && item.wslInstall) || item.install[platform.os];
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
    keepOn: {
      windows: "It's part of Windows: remove it in Settings → System → Optional features if you really want to.",
      linux: "Git, servers and many other tools need the SSH client, so dkit won't remove it.",
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
      windows: { type: "winget", id: "OpenJS.NodeJS.LTS", also: ["OpenJS.NodeJS", "OpenJS.NodeJS.20", "OpenJS.NodeJS.22", "OpenJS.NodeJS.24", "OpenJS.NodeJS.26"] },
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
    detect: { command: "python", commandFor: { macos: "python3", linux: "python3" }, versionArgs: ["--version"] },
    install: {
      windows: { type: "winget", id: "Python.Python.3.13", also: ["Python.Python.3.11", "Python.Python.3.12", "Python.Python.3.14", "Python.Python.3.15"] },
      macos: { type: "brew", formula: "python" },
      linux: { type: "apt", packages: ["python3", "python3-pip", "python3-venv"] },
    },
    keepOn: { linux: "Linux itself runs on Python 3 (removing it can break the desktop and apt), so dkit won't remove it." },
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
    selfUpdate: ["bun", "upgrade"],
    removeManually: { linux: "Delete the ~/.bun folder, then remove the Bun lines (BUN_INSTALL, PATH) from ~/.bashrc." },
    notes: ["Open a new terminal so `bun` is on your PATH."],
  },
  {
    id: "go",
    name: "Go",
    kind: "machine",
    description: "The Go programming language and toolchain (go build, go run, go get).",
    category: "Languages",
    detect: { command: "go", versionArgs: ["version"], paths: { windows: ["%ProgramFiles%\\Go\\bin\\go.exe"] } },
    install: {
      windows: { type: "winget", id: "GoLang.Go" },
      macos: { type: "brew", formula: "go" },
      linux: { type: "apt", packages: ["golang-go"] },
    },
    notes: ["Open a new terminal so `go` is on your PATH."],
  },
  {
    id: "flutter",
    name: "Flutter",
    kind: "machine",
    description: "Google's SDK for building mobile, desktop and web apps from one Dart codebase.",
    category: "Languages",
    detect: { command: "flutter", versionArgs: ["--version"] },
    install: {
      windows: { type: "manual", url: "https://docs.flutter.dev/get-started/install/windows" },
      macos: { type: "brew", cask: "flutter" },
      linux: { type: "manual", url: "https://docs.flutter.dev/get-started/install/linux" },
    },
    requires: { all: ["git"] },
    notes: ["Run `flutter doctor` to see what else your platform needs (Android Studio, Xcode, Chrome...)."],
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
      windowsSideInWsl: true,
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
      windowsSideInWsl: true,
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
    selfUpdate: ["claude", "update"],
    npmAlt: "@anthropic-ai/claude-code",
    removeManually: {
      windows: "Delete %USERPROFILE%\\.local\\bin\\claude.exe and the %USERPROFILE%\\.local\\share\\claude folder. Your settings in ~/.claude stay.",
      macos: "Delete ~/.local/bin/claude and the ~/.local/share/claude folder. Your settings in ~/.claude stay.",
      linux: "Delete ~/.local/bin/claude and the ~/.local/share/claude folder. Your settings in ~/.claude stay.",
    },
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
      windows: { type: "winget", id: "PostgreSQL.PostgreSQL.17", also: ["PostgreSQL.PostgreSQL.15", "PostgreSQL.PostgreSQL.16", "PostgreSQL.PostgreSQL.18"] },
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
  {
    id: "redis",
    name: "Redis",
    kind: "machine",
    description: "In-memory data store for caching, queues and sessions. On Windows: Memurai, a Redis-compatible server.",
    category: "Databases",
    detect: {
      command: "redis-server",
      commandFor: { windows: "memurai" },
      versionArgs: ["--version"],
      paths: { windows: ["%ProgramFiles%\\Memurai\\memurai.exe"] },
    },
    install: {
      // Redis has no official Windows build; Memurai Developer is a free Redis-compatible server for development.
      windows: { type: "winget", id: "Memurai.MemuraiDeveloper" },
      macos: { type: "brew", formula: "redis" },
      linux: { type: "apt", packages: ["redis-server"] },
    },
    notes: [
      "It listens on localhost:6379. Windows (Memurai) and Linux start it as a service; on macOS run `brew services start redis`.",
    ],
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
    // In WSL, Docker Desktop on Windows provides `docker`: turn on Settings → Resources → WSL integration for this distro.
    wslInstall: { type: "manual", url: "Docker Desktop → Settings → Resources → WSL integration → turn on this distro (https://docs.docker.com/desktop/features/wsl/)" },
    prereqs: {
      windows: [
        { type: "windows-build", min: 19045 },
        { type: "virtualization" },
        { type: "windows-feature", name: "VirtualMachinePlatform", label: "Virtual Machine Platform" },
        { type: "windows-feature", name: "Microsoft-Windows-Subsystem-Linux", label: "Windows Subsystem for Linux" },
        { type: "wsl" },
      ],
    },
    notes: [
      "Open Docker Desktop once to finish setup. If `docker` says permission denied, sign out and back in.",
      "On Linux, let yourself use it without sudo: sudo usermod -aG docker $USER (then sign out and back in).",
    ],
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
  {
    id: "ioredis",
    name: "ioredis",
    kind: "project",
    description: "Redis client for Node.js, with clusters, pipelines and TypeScript types.",
    category: "Database libraries",
    detect: {},
    install: {},
    packages: { deps: ["ioredis"] },
    notes: ["Connect with `new Redis(process.env.REDIS_URL)`, e.g. REDIS_URL=redis://localhost:6379"],
  },
  {
    id: "stripe",
    name: "Stripe",
    kind: "project",
    description: "Stripe's official Node.js library for payments, subscriptions and webhooks.",
    category: "Payments & email",
    detect: {},
    install: {},
    packages: { deps: ["stripe"] },
    notes: ["Set STRIPE_SECRET_KEY (and STRIPE_WEBHOOK_SECRET for webhooks) in your .env. Use test-mode keys while developing."],
  },
  {
    id: "resend",
    name: "Resend",
    kind: "project",
    description: "Resend's Node.js library for sending transactional email.",
    category: "Payments & email",
    detect: {},
    install: {},
    packages: { deps: ["resend"] },
    notes: ["Set RESEND_API_KEY in your .env, and verify your sending domain in the Resend dashboard."],
  },

  // ── Python libraries (a project with requirements.txt or pyproject.toml; pip in .venv) ──
  {
    id: "fastapi",
    name: "FastAPI",
    kind: "project",
    description: "Python web framework for APIs, with automatic docs. Includes the `fastapi dev` server.",
    category: "Frameworks",
    detect: {},
    install: {},
    packages: { ecosystem: "python", deps: ["fastapi[standard]"] },
    notes: ["While it runs (`fastapi dev main.py`), interactive API docs are at http://127.0.0.1:8000/docs"],
  },
  {
    id: "sqlalchemy",
    name: "SQLAlchemy",
    kind: "project",
    description: "Python's SQL toolkit and ORM.",
    category: "Database libraries",
    detect: {},
    install: {},
    packages: { ecosystem: "python", deps: ["sqlalchemy"] },
    suggests: { ids: ["psycopg"], what: "a database driver" },
  },
  {
    id: "psycopg",
    name: "psycopg (PostgreSQL)",
    kind: "project",
    description: "PostgreSQL driver for Python, used by SQLAlchemy.",
    category: "Database libraries",
    detect: {},
    install: {},
    packages: { ecosystem: "python", deps: ["psycopg[binary]"] },
    notes: ["SQLAlchemy URL: postgresql+psycopg://postgres:<password>@localhost:5432/<db>"],
  },

  // ── Go libraries (a project with go.mod; go get) ──
  {
    id: "gin",
    name: "Gin",
    kind: "project",
    description: "Fast HTTP web framework for Go.",
    category: "Frameworks",
    detect: {},
    install: {},
    packages: { ecosystem: "go", deps: ["github.com/gin-gonic/gin"] },
    notes: ["Start it with `go run .` (listens on :8080)."],
  },
  {
    id: "pgx",
    name: "pgx (PostgreSQL)",
    kind: "project",
    description: "PostgreSQL driver and toolkit for Go.",
    category: "Database libraries",
    detect: {},
    install: {},
    packages: { ecosystem: "go", deps: ["github.com/jackc/pgx/v5"] },
    notes: ["Connect with pgxpool.New(ctx, os.Getenv(\"DATABASE_URL\")). `go mod tidy` drops modules your code doesn't import yet."],
  },
  {
    id: "go-redis",
    name: "go-redis",
    kind: "project",
    description: "Redis client for Go.",
    category: "Database libraries",
    detect: {},
    install: {},
    packages: { ecosystem: "go", deps: ["github.com/redis/go-redis/v9"] },
  },

  // ── Flutter libraries (a project with pubspec.yaml; flutter pub add) ──
  {
    id: "flutter-bloc",
    name: "flutter_bloc",
    kind: "project",
    description: "BLoC state management for Flutter: widgets that rebuild from streams of state.",
    category: "App architecture",
    detect: {},
    install: {},
    packages: { ecosystem: "flutter", deps: ["flutter_bloc"] },
  },
  {
    id: "get-it",
    name: "get_it",
    kind: "project",
    description: "Service locator for Dart and Flutter: register services once, get them anywhere (dependency injection).",
    category: "App architecture",
    detect: {},
    install: {},
    packages: { ecosystem: "flutter", deps: ["get_it"] },
  },
];

export const CATEGORIES: Category[] = [
  "Essentials", "Languages", "Editors & AI", "Databases", "Tools",
  "Frameworks", "Database libraries", "Auth", "Payments & email", "App architecture",
];

export function getItem(id: string): CatalogItem | undefined {
  return CATALOG.find((i) => i.id === id);
}

export function requiresFor(item: CatalogItem, os: OS): string[] {
  return [...(item.requires?.all ?? []), ...(item.requires?.[os] ?? [])];
}
