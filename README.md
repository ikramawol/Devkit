# devsetupkit-cli

[![npm](https://img.shields.io/npm/v/devsetupkit-cli)](https://www.npmjs.com/package/devsetupkit-cli)
[![license](https://img.shields.io/npm/l/devsetupkit-cli)](LICENSE)

Set up a developer machine with one command, and move your whole setup to a new PC or OS.

## Install

Needs Node.js 20 or newer.

```powershell
npm install -g devsetupkit-cli
```

The package is called `devsetupkit-cli`; the command it installs is **`dkit`**:

```powershell
dkit doctor          # see what's installed
dkit --help          # all commands
```

Update with `npm install -g devsetupkit-cli@latest`, remove with `npm uninstall -g devsetupkit-cli`.

## Setup from source (Windows, PowerShell)

```powershell
git clone https://github.com/ikramawol/Devkit.git
cd Devkit
npm install
npm run build
npm link          # makes `dkit` available everywhere
```

## Install tools

Nothing is installed unless you pick it.

```powershell
dkit doctor                      # what's installed, what's missing (alias: dkit list)
dkit install                     # checklist: pick with space, confirm with enter
dkit install git node claude     # just these
dkit install --all --dry-run     # show the plan for everything, change nothing
dkit claude                      # shortcut for `dkit install claude`
dkit info docker                 # one tool: status, support level, what it needs
dkit catalog                     # every tool, its installer and support level
dkit catalog --check             # confirm every winget package id on this PC
```

Dependencies are added for you: picking Codex, Prettier or ESLint adds Node.js; Claude Code on Windows adds Git.

### System prerequisites

Some tools need the OS set up first. `dkit doctor` lists what's missing under each tool, and `dkit install` shows a checklist, sets up each missing item, ticks it off, and only then installs the tool:

```
Docker needs these set up first:
  ✓ Windows build 19045 or newer
  ✓ CPU virtualization turned on
  ○ Virtual Machine Platform       will turn on (admin prompt, restart)
  ○ Windows Subsystem for Linux    will turn on (admin prompt, restart)
  ○ WSL 2                          will install (admin prompt, restart)
```

- `○` dkit sets it up (each one shows a Windows admin prompt)
- `✗` you have to do it yourself (turn on virtualization in BIOS, update Windows); dkit won't install the tool until it's fixed
- A tool that's installed but missing what it needs (e.g. Docker without WSL) can be picked again; dkit sets up only the missing pieces
- If anything needs a restart, the summary says so

Prerequisites are declared per tool with `prereqs` in `src/core/catalog.ts` (types: `windows-build`, `virtualization`, `windows-feature`, `wsl` in `src/core/prereqs.ts`).

### Support levels

Not every tool is supported equally, and dkit says so. `dkit catalog` and `dkit info <id>` show a level worked out from what dkit can actually do for that tool on your OS:

| Level | Means |
|---|---|
| L1 Discover | tells whether it's installed |
| L2 Install | installs it with your OS's installer |
| L3 Configure | applies settings for you |
| L4 Snapshot & restore | `dkit migrate` saves and restores its settings |
| L5 Maintain | updates, uninstalls and diagnoses it |

Today every tool is at L2 on Windows. `+S` marks tools whose settings already move with `dkit migrate` (VS Code, Antigravity, Git, Claude Code, Node's global packages, SSH config).

| Group | Tools (id) |
|---|---|
| Essentials | Git (`git`), Git Bash (`git-bash`), OpenSSH (`openssh`), GitHub CLI (`gh`) |
| Languages | Node.js + npm (`node`), Python (`python`), pnpm (`pnpm`), Yarn (`yarn`), Bun (`bun`) |
| Editors & AI | VS Code (`vscode`), Antigravity (`antigravity`), Claude Code (`claude`), Codex CLI (`codex`) |
| Databases | PostgreSQL 17 (`postgresql`), pgAdmin (`pgadmin`), MongoDB (`mongodb`), MongoDB Compass (`compass`) |
| Tools | Docker (`docker`), Postman (`postman`), Prettier (`prettier`), ESLint (`eslint`) |

Windows uses winget (plus the official Claude Code installer and npm). macOS uses Homebrew. Linux uses apt; tools with no apt package show a download link.

## Add libraries to a project

Libraries like Hono or Kysely belong to a project, not to your computer, so dkit adds them to the project's `package.json` with the project's own package manager.

```powershell
cd my-api
dkit install hono kysely dbmate          # adds them to my-api
dkit install drizzle --project ../web    # a different project
dkit install prisma --pm pnpm            # override the package manager
dkit doctor                              # inside a project: also lists which libraries it has
```

- **Which project:** the folder you're in, or `--project <folder>`. It must have a `package.json`; dkit never edits a parent folder's project by accident.
- **Which package manager:** `packageManager` in package.json, else the lockfile (`pnpm-lock.yaml`, `bun.lock`, `yarn.lock`, `package-lock.json`), else npm. If that package manager isn't installed, dkit installs it first (pnpm and Yarn need Node.js; Bun doesn't).
- Only missing libraries are added, regular and dev dependencies in one command each, and the result is checked against package.json.
- Machine tools and libraries can be mixed: `dkit install gh hono`.

| Group | Libraries (id) |
|---|---|
| Frameworks | Hono (`hono`), Express (`express` + dev @types/express) |
| Database libraries | Kysely (`kysely`), Drizzle ORM (`drizzle`: drizzle-orm + dev drizzle-kit), Prisma (`prisma`: @prisma/client + dev prisma at the same version), dbmate (`dbmate`, dev), node-postgres (`pg` + dev @types/pg) |
| Auth | Better Auth (`better-auth`) |

## Stacks: start a project with everything in one go

A stack is a ready-made combination of tools and libraries. Use it to create a new project, or to add the whole combination to a project you already have.

```powershell
dkit stack list                                       # built-in and your own stacks
dkit stack info next-hono                             # what's in it, and what you already have

dkit stack install hono-api --project my-api          # new project: tools, then the official starter, then libraries
cd my-shop; dkit stack install solid-hono             # existing project: adds only what's missing
dkit stack install next-hono --project web --without drizzle --with prisma   # swap parts
```

| Stack (id) | Creates the project with | Tools | Libraries |
|---|---|---|---|
| `next-hono` | create-next-app | Node.js, PostgreSQL | Hono, Better Auth, Drizzle, pg |
| `solid-hono` | create-solid (Vite + TS) | Node.js, PostgreSQL | Hono, Kysely, pg, dbmate |
| `hono-api` | create-hono (Node.js template) | Node.js, PostgreSQL | Hono, Drizzle, pg |
| `express-prisma` | your package manager's `init` | Node.js, PostgreSQL | Express, Prisma |

How it works:

- **New project** (`--project <new-folder>`): installs the tools that are missing, runs the framework's own official starter without prompts, then adds the libraries with the project's package manager (`--pm` to choose; npm by default). The folder must not exist yet or be empty.
- **Existing project** (you're inside one): no starter; only the missing tools and libraries are added.
- Everything is picked by default; untick what you don't want, or use `--without` / `--with`. Already-installed PostgreSQL, Node.js etc. are detected and left alone.
- `--dry-run` shows every command first.

### Your own stacks

```powershell
dkit stack save my-api --from hono-api --without drizzle --with kysely,dbmate
dkit stack save tools-only --with git,node,vscode,docker
dkit stack install my-api --project new-thing
```

Saved stacks are JSON files in `~/.dkit/stacks/`. To share one, send the file; others run `dkit stack install ./my-api.json --project app`. A stack file can only list catalog ids and a starter id: anything else (like a command to run) is refused, so a stack from someone else can't run anything unexpected.

## Migrate to a new PC or OS

On the old machine:

```powershell
dkit migrate export              # writes dkit-backup-<pc>-<date>.json
```

Copy the file to the new machine, then:

```powershell
dkit migrate restore dkit-backup-....json --dry-run   # see every change first
dkit migrate restore dkit-backup-....json             # pick sections, then apply
dkit migrate restore backup.json --only editors,git     # just some sections
```

What's carried over:

| Section | Contents |
|---|---|
| `tools` | Every catalog tool you had, reinstalled with the new OS's installer |
| `apps` | Other apps winget knows about (Windows → Windows, none preselected) |
| `editors` | VS Code and Antigravity extensions, settings, keybindings, tasks, snippets |
| `git` | Global Git config and global gitignore |
| `claude` | `~/.claude` settings, CLAUDE.md, commands, agents, skills, output styles, user MCP servers |
| `npm` | Global npm packages |
| `ssh` | `~/.ssh/config` (never keys) |
| `shell` | PowerShell profile, or .bashrc/.zshrc (only restored on a matching OS) |

Safety rules:

- Secret values (tokens, API keys, passwords) are replaced with `<REDACTED>` on export, including keys set in your shell profile (`$env:OPENAI_API_KEY = "..."`, `export GITHUB_TOKEN=...`); restore tells you which to fill back in
- Never exported: SSH private keys, login sessions, Claude credentials, chat history, database data
- Every file that would be overwritten is copied to `*.dkit-backup-<time>` first
- Every file has a checksum; a damaged backup is refused
- Paths from the old OS (like `C:\Tools\vim.exe` on Linux) are flagged instead of applied

## Development

```
npm run dev -- doctor     # run without building
npm test                  # tests run on a fake machine; nothing is really installed
```

```
src/
  index.ts              CLI entry
  commands/             doctor, info, install, stack, migrate
  core/catalog.ts       every tool and library: how to find and install it on each OS
  core/detect.ts        is a tool installed?
  core/engine.ts        plan → confirm → install → verify
  core/prereqs.ts       OS prerequisites (Windows features, WSL, ...): check and set up
  core/maturity.ts      support level (L1-L5) per tool, worked out from its catalog entry
  core/project.ts       projects: package.json, package manager, adding libraries
  core/starters.ts      official project starters (create-next-app, create-solid, create-hono, init)
  core/stack.ts         stack recipes: built-ins, validation, save/load, install
  adapters/methods.ts   winget, brew, apt, npm, scripts
  migrate/              backup format, export, restore
  utils/                safe command runner, prompts, logger
```

To add a tool, add one entry to `src/core/catalog.ts` (id, name, kind, description, detect, install). For a project library use `kind: "project"` and `packages: { deps, dev }` instead of detect/install. `dkit info <id>` then shows what you've given it.

## License

MIT, see [LICENSE](LICENSE).
