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

Today every tool is at L2 on Windows, because nothing configures tools yet (L3). Two marks show what else works:
- `+S`: its settings move with `dkit migrate` (VS Code, Antigravity, Git, Claude Code, Node's global packages, SSH config).
- `+M`: `dkit update` and `dkit uninstall` handle it (anything installed with winget, Homebrew, apt or npm).

| Group | Tools (id) |
|---|---|
| Essentials | Git (`git`), Git Bash (`git-bash`), OpenSSH (`openssh`), GitHub CLI (`gh`) |
| Languages | Node.js + npm (`node`), Python (`python`), pnpm (`pnpm`), Yarn (`yarn`), Bun (`bun`), Go (`go`), Flutter (`flutter`) |
| Editors & AI | VS Code (`vscode`), Antigravity (`antigravity`), Claude Code (`claude`), Codex CLI (`codex`) |
| Databases | PostgreSQL 17 (`postgresql`), pgAdmin (`pgadmin`), MongoDB (`mongodb`), MongoDB Compass (`compass`), Redis (`redis`; on Windows: Memurai, a Redis-compatible server) |
| Tools | Docker (`docker`), Postman (`postman`), Prettier (`prettier`), ESLint (`eslint`) |

Windows uses winget (plus the official Claude Code installer and npm). macOS uses Homebrew. Linux uses apt; tools with no apt package show a download link.

## Add libraries to a project

Libraries like Hono or Kysely belong to a project, not to your computer, so dkit adds them to the project with the project's own tool. dkit knows four kinds of project, by their files:

| Project | Found by | Libraries are added with |
|---|---|---|
| JavaScript | `package.json` | npm, pnpm, Yarn or Bun |
| Python | `requirements.txt` or `pyproject.toml` | pip, inside the project's `.venv` (created if missing), and recorded in `requirements.txt` |
| Go | `go.mod` | `go get` |
| Flutter | `pubspec.yaml` | `flutter pub add` |

A library only goes into its own kind of project: asking for Gin in a JavaScript project is refused with a clear message.

```powershell
cd my-api
dkit install hono kysely dbmate          # adds them to my-api
dkit install drizzle --project ../web    # a different project
dkit install prisma --pm pnpm            # override the package manager
dkit doctor                              # inside a project: also lists which libraries it has
```

- **Which project:** the folder you're in, or `--project <folder>`. dkit never edits a parent folder's project by accident.
- **Which package manager (JavaScript):** `packageManager` in package.json, else the lockfile (`pnpm-lock.yaml`, `bun.lock`, `yarn.lock`, `package-lock.json`), else npm. If that package manager isn't installed, dkit installs it first (pnpm and Yarn need Node.js; Bun doesn't). Python, Go and Flutter projects need Python, Go or Flutter, which dkit installs first too.
- Only missing libraries are added, regular and dev dependencies in one command each, and the result is checked against the project's own files.
- Machine tools and libraries can be mixed: `dkit install gh hono`.

| Group | Libraries (id) |
|---|---|
| Frameworks | Hono (`hono`), Express (`express` + dev @types/express) |
| Database libraries | Kysely (`kysely`), Drizzle ORM (`drizzle`: drizzle-orm + dev drizzle-kit), Prisma (`prisma`: @prisma/client + dev prisma at the same version), dbmate (`dbmate`, dev), node-postgres (`pg` + dev @types/pg), ioredis (`ioredis`) |
| Auth | Better Auth (`better-auth`) |
| Payments & email | Stripe (`stripe`), Resend (`resend`) |
| Python | FastAPI (`fastapi`: fastapi[standard]), SQLAlchemy (`sqlalchemy`), psycopg (`psycopg`: psycopg[binary]) |
| Go | Gin (`gin`), pgx (`pgx`), go-redis (`go-redis`) |
| Flutter | flutter_bloc (`flutter-bloc`), get_it (`get-it`) |

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
| `next-drizzle-auth` | create-next-app | Node.js, PostgreSQL | Better Auth, Drizzle, pg |
| `react-hono` | create-vite (react-ts) | Node.js, PostgreSQL | Hono, pg |
| `nest-prisma-redis` | the Nest CLI (`nest new`) | Node.js, PostgreSQL, Redis | Prisma, ioredis |
| `express-kysely` | your package manager's `init` | Node.js, PostgreSQL | Express, Kysely, pg |
| `next-saas` | create-next-app | Node.js | Better Auth, Stripe, Resend |
| `fastapi-sqlalchemy` | a `.venv`, `requirements.txt` and FastAPI's hello-world `main.py` | Python, PostgreSQL | FastAPI, SQLAlchemy, psycopg |
| `gin-redis` | `go mod init` and Gin's hello-world `main.go` | Go, PostgreSQL, Redis | Gin, pgx, go-redis |
| `flutter-bloc` | `flutter create` | Flutter | flutter_bloc, get_it |

How it works:

- **New project** (`--project <new-folder>`): installs the tools that are missing, runs the framework's own official starter without prompts, then adds the libraries with the project's package manager (`--pm` to choose for JavaScript stacks; npm by default). FastAPI and Go have no official generator, so dkit writes only the hello-world file from their own tutorials. The folder must not exist yet or be empty.
- **On Windows, Smart App Control** (or a company policy) can block Python packages that include compiled parts, such as SQLAlchemy and psycopg. You'll see `ImportError: DLL load failed ... An Application Control policy has blocked this file`. That's a Windows security setting, not dkit; the project itself is set up correctly.
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

## Describe your setup and compare PCs

A **manifest** is a short file that describes your setup: which tools you have and their versions, editor extensions, global npm packages, Git preferences, and the names of the secrets you use. It lists what you want, not how one OS installs it, so the same file works on Windows, macOS and Linux.

```powershell
dkit scan                              # what's on this PC (changes nothing)
dkit scan -o dkit-manifest.json        # save it
dkit status dkit-manifest.json         # compare this PC with it, then offer to install what's missing
dkit status dkit-manifest.json --dry-run
dkit status dkit-manifest.json --check # only report; exit code 1 if anything differs (CI, scripts)
dkit status dkit-backup-....dkit       # a migrate backup works too
```

`dkit status` shows each item as `✓` (matches), `✗` (missing), `↓` (older than the manifest), `≠` (set differently) or `?` (not known to this dkit version). Then it:

- installs missing tools (and project libraries, when you run it inside a project) with the usual plan → confirm → install steps, including prerequisites
- installs missing editor extensions and global npm packages, and sets missing Git preferences, after asking once
- never removes anything, and never changes a Git setting you've already set
- tells you what's left for you: tools to update (with the command), secrets to set, settings it won't apply

Safe to share:

- **Left out:** your Git name and email, your computer's name, folder paths, and every secret value. Secrets appear by name only (`OPENAI_API_KEY`, used in your PowerShell profile), so `status` can tell you whether it's set.
- **Git settings:** only plain preferences (`init.defaultBranch`, `pull.rebase`, …) and aliases that don't start with `!` are applied from a manifest. Settings that can start a program (`core.sshCommand`, `core.editor`, `!` aliases) are shown with the command to run yourself.
- **Checked when loaded:** ids, package names and extension ids are checked on load, and a file that doesn't fit is refused.

Run `dkit scan` inside a project to also record its package manager and libraries. `dkit migrate export` puts the same manifest inside every backup.

## Share a setup with your team

A team keeps its setup in a Git repository (private is fine). Everyone connects once, and dkit keeps it up to date.

```
dkit-team.json     the team's name and description
baseline.json      what everyone should have (a manifest, made with dkit scan)
stacks/*.json      the team's stacks
```

Whoever sets it up:

```powershell
dkit team init dev-setup --name "Acme web team" --stacks my-api   # baseline from this PC, plus your stacks
# edit dev-setup/baseline.json to keep only what's for everyone, then push it to GitHub
```

Everyone else:

```powershell
dkit team add https://github.com/acme/dev-setup     # or git@github.com:acme/dev-setup.git
dkit team status                  # fetch the latest, compare this PC with the baseline, offer to install what's missing
dkit team status --check          # only report (CI, onboarding scripts)
dkit stack list                   # the team's stacks are listed too
dkit stack install my-api --project app       # or acme/my-api if the id clashes
dkit team update                  # get the latest stacks
dkit team list / dkit team remove dev-setup
```

A team repository gets the same checks as a file from a stranger. Stacks and the baseline can only name catalog tools, libraries and starters. Git settings follow the manifest rules above, and anything that doesn't fit is reported and not used. dkit clones with symlinks turned off and only accepts https, ssh and local Git URLs. Private repositories work when `git clone <url>` works for you.

## Migrate to a new PC or OS

On the old machine:

```powershell
dkit migrate export              # asks for a password, writes dkit-backup-<pc>-<date>.dkit
dkit migrate export -o E:\       # straight to a USB drive
```

Copy the file to the new machine, then:

```powershell
dkit migrate inspect dkit-backup-....dkit             # what's inside, and is it intact (changes nothing)
dkit migrate compare dkit-backup-....dkit             # what differs on this PC: tools, extensions, settings files
dkit migrate restore dkit-backup-....dkit --dry-run   # see every change first
dkit migrate restore dkit-backup-....dkit             # pick sections, then apply
dkit migrate restore backup.dkit --only editors,git   # just some sections
```

The backup is one compressed, **encrypted** file:

- **Encryption:** AES-256-GCM, with the key derived from your password by scrypt. It's built into Node, so there's nothing extra to install.
- **The password can't be recovered.** Without it the backup can't be opened.
- **Damage and tampering:** any change to the file is detected and the backup is refused, rather than half-restored.
- **Scripts:** set `DKIT_BACKUP_PASSWORD` instead of typing the password. `--no-encrypt` makes an unencrypted (still compressed and checksummed) file.
- **Old backups:** `.json` backups from dkit 0.2 still restore.

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

Moving between Windows, macOS and Linux:

- **Tools:** reinstalled with the new OS's installer (winget ↔ Homebrew ↔ apt). Tools with no installer there are listed for you to install.
- **Shell profile:** a PowerShell profile can't run on macOS or Linux, and a .bashrc/.zshrc can't run on Windows. dkit converts environment variables and simple aliases into `~/.dkit/converted/profile.sh` (or `profile.ps1`), and tells you the one line to add to your own profile to load it. Anything more complex is left out and counted, not guessed.
- **Git:** `core.autocrlf` becomes the new OS's usual setting (`true` on Windows, `input` elsewhere). Windows-only editors like Notepad++ aren't set on macOS or Linux.
- **MCP servers and settings that point at the old OS's folders** (like `C:\Tools\mcp.exe`) are listed for you instead of being applied.

On Linux, apt installs use `sudo`, or run directly when you're root (in containers, for example). Inside WSL, Windows programs on the PATH (`/mnt/c/...`) don't count as Linux tools, except VS Code and Antigravity, which you use from Windows.

Safety rules:

- Secret values (tokens, API keys, passwords) are replaced with `<REDACTED>` on export, including keys set in your shell profile (`$env:OPENAI_API_KEY = "..."`, `export GITHUB_TOKEN=...`); restore tells you which to fill back in
- Never exported: SSH private keys, login sessions, Claude credentials, chat history, database data
- Every file that would be overwritten is copied to `*.dkit-backup-<time>` first
- Every file has a checksum; a damaged backup is refused
- Paths from the old OS (like `C:\Tools\vim.exe` on Linux) are flagged instead of applied

## Automatic snapshots

Let dkit back up your setup on a schedule, so you always have a recent backup if a PC dies or a change goes wrong.

```powershell
dkit snapshot schedule                       # every day at 12:00, keep the last 7 (asks for a password once)
dkit snapshot schedule --every weekly --day fri --time 18:00 --keep 4 --folder D:\dkit-snapshots
dkit snapshot run                            # take one now
dkit snapshot list                           # snapshots, schedule, how the last run went
dkit snapshot unschedule [--forget-password] # turn it off (snapshots are kept)
```

- **What a snapshot is:** an ordinary encrypted `.dkit` backup, exactly like `dkit migrate export`. Open one with `dkit migrate inspect`, `compare` or `restore`, on any PC, with your password.
- **Pruning:** only the newest `--keep` snapshots are kept. dkit only deletes files it named itself (`snapshot-<pc>-<date>-<time>.dkit`).
- **The password** is kept in your OS's secure storage, so the job can run without asking:
  - **Windows:** DPAPI (encrypted with your Windows login).
  - **macOS:** your Keychain.
  - **Linux:** your keyring through `secret-tool`. On servers or WSL with no keyring, it goes in a file only your user can read, and dkit tells you.
  - It's never put on a command line.
- **The schedule** uses the OS's own scheduler, for your user only, with no admin rights:
  - **Windows:** a Task Scheduler task "dkit snapshot". It runs hidden, and catches up after the PC was off.
  - **macOS:** a launchd agent. It catches up after sleep.
  - **Linux:** a marked line in your crontab.
- **When the job fails**, the result goes to `~/.dkit/snapshots.log`, and `dkit snapshot list` shows it.
- **If you update Node.js or reinstall dkit**, run `dkit snapshot schedule` again so the job points at the new location.

## Sync your PCs through a cloud folder

Keep a laptop and a desktop (Windows, macOS or Linux, in any mix) in step through OneDrive, Dropbox, Google Drive or iCloud Drive. dkit only writes files into the folder; your cloud app uploads them. dkit never signs in to anything.

```
dkit sync init          # first PC: finds your cloud folder, you choose a password
dkit sync init          # each other PC: same cloud account, same password
dkit sync push          # after you change your setup: save this PC's setup
dkit sync status        # every PC, and how each differs from this one
dkit sync pull          # compare with the PC that pushed last, pick what to bring over
dkit sync pull --from laptop --dry-run
dkit sync leave         # stop syncing on this PC (forgets the folder and the password)
```

**How it works:**
- **One file per PC.** Each PC saves its setup as one encrypted file in `<cloud folder>/dkit-sync/machines/<pc-name>.dkit`. That's the same encrypted backup as `dkit migrate export`, so the cloud only ever sees encrypted data. File names are the PCs' names, nothing more.
- **One shared password, saved on each PC.** Every PC uses the same password, kept in that PC's secure storage (DPAPI, Keychain, keyring), so you type it only once per PC. It's separate from the snapshot password.
- **`pull` is a restore you approve.** It shows the differences first, lets you pick what to bring over, and asks before writing. Tools and extensions are only ever added, never removed. A settings file that gets replaced is copied first. Between different OSes, tools are installed with this OS's installer and settings are translated, like `dkit migrate restore`.
- **Conflicts are left alone.** A cloud app's conflict copies (like `laptop (1).dkit`) are ignored, and files are written in one step, so a half-uploaded file is never read.
- **Folders that aren't found automatically:** use `--folder` (for example, in WSL: `--folder /mnt/c/Users/<you>/OneDrive`). Two PCs with the same name: use `--name`.

## Keep your tools healthy

```
dkit diagnose                 # updates waiting, duplicate installs, PATH mistakes (changes nothing)
dkit diagnose --offline       # the same, without the slower update check
dkit update                   # pick from the tools that have updates
dkit update git node          # update these
dkit update --all --dry-run   # see what would be updated
dkit uninstall postman        # remove a tool (asks first; --dry-run to preview)
```

**What `dkit diagnose` looks for:**
- **Updates** that winget, Homebrew, apt or npm know about. apt answers from its last `sudo apt update`.
- **Two copies of a tool** on PATH, and which one runs. On Windows it also catches `python` opening the Microsoft Store instead of your Python.
- **Tools that are installed but not on PATH**, so terminals can't find them. This includes npm's global folder.
- **PATH folders that no longer exist, or are listed twice.** On Windows it checks the saved PATH that new terminals get, not the extra folders your current shell adds.

It never changes anything. It prints what to do, and exits with code 1 if it found a problem.

**How `dkit update` and `dkit uninstall` stay safe:**
- **They use the installer the tool came from.** That's winget, Homebrew, apt or npm. Claude Code updates with `claude update`, or with npm if you installed it from npm. Something you installed another way is left alone, with a note on how to handle it yourself.
- **Uninstall removes only the program.** Settings, projects and databases' data stay. On Linux, apt shows what it will remove and asks you itself.
- **Uninstall warns about tools that would stop working**, for example Prettier without Node.js. It removes tools in a safe order.
- **Some tools are never removed.** These are OpenSSH, Python on Linux (the system needs it), and anything that's part of the OS. For tools installed with a script, it tells you which files to delete.
- **Project libraries aren't touched.** Use your package manager (`npm update`, `pnpm update`).

## Development

```
npm run dev -- doctor     # run without building
npm test                  # tests run on a fake machine; nothing is really installed
```

```
src/
  index.ts              CLI entry
  commands/             doctor, info, install, diagnose/update/uninstall, stack, scan/status, migrate, team, snapshot, sync
  core/catalog.ts       every tool and library: how to find and install it on each OS
  core/detect.ts        is a tool installed?
  core/engine.ts        plan → confirm → install → verify
  core/prereqs.ts       OS prerequisites (Windows features, WSL, ...): check and set up
  core/maturity.ts      support level (L1-L5) per tool, worked out from its catalog entry
  core/project.ts       projects: package.json, package manager, adding libraries
  core/starters.ts      official project starters (create-next-app, create-solid, create-hono, init)
  core/stack.ts         stack recipes: built-ins, validation, save/load, install
  core/team.ts          team setups: a Git repo with stacks and a baseline (add, update, init)
  adapters/methods.ts   winget, brew, apt, npm, scripts
  manifest/             scan this machine, the manifest format, compare and fix (dkit scan / status)
  migrate/              backup format, encrypted .dkit archive, export, inspect/compare, restore,
                        transform.ts: translating settings between OSes
  maintain/             update checks, update/uninstall plans (maintain.ts), PATH and duplicate checks (diagnose.ts)
  sync/                 cloud folders (cloud.ts), the sync folder: push, read, check the password (sync.ts)
  snapshot/             scheduled snapshots: taking and pruning them, OS schedulers (Task Scheduler, launchd, cron)
  utils/                safe command runner, prompts, logger, secret-store.ts (DPAPI / Keychain / keyring)
```

To add a tool, add one entry to `src/core/catalog.ts` (id, name, kind, description, detect, install). For a project library use `kind: "project"` and `packages: { deps, dev }` instead of detect/install. `dkit info <id>` then shows what you've given it.

## License

MIT, see [LICENSE](LICENSE).
