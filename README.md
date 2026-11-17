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
dkit catalog --check             # confirm every winget package id on this PC
```

Dependencies are added for you: picking Codex, Prettier or ESLint adds Node.js; Claude Code on Windows adds Git.

| Group | Tools (id) |
|---|---|
| Essentials | Git (`git`), Git Bash (`git-bash`), OpenSSH (`openssh`), GitHub CLI (`gh`) |
| Languages | Node.js + npm (`node`), Python (`python`) |
| Editors & AI | VS Code (`vscode`), Antigravity (`antigravity`), Claude Code (`claude`), Codex CLI (`codex`) |
| Databases | PostgreSQL 17 (`postgresql`), pgAdmin (`pgadmin`), MongoDB (`mongodb`), MongoDB Compass (`compass`) |
| Tools | Docker (`docker`), Postman (`postman`), Prettier (`prettier`), ESLint (`eslint`) |

Windows uses winget (plus the official Claude Code installer and npm). macOS uses Homebrew. Linux uses apt; tools with no apt package show a download link.

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

- Secret values (tokens, API keys, passwords) are replaced with `<REDACTED>` on export
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
  commands/             doctor, install, migrate
  core/catalog.ts       the 18 tools and how to install each on each OS
  core/detect.ts        is a tool installed?
  core/engine.ts        plan → confirm → install → verify
  adapters/methods.ts   winget, brew, apt, npm, scripts
  migrate/              backup format, export, restore
  utils/                safe command runner, prompts, logger
```

To add a tool, add one entry to `src/core/catalog.ts`.

## License

MIT, see [LICENSE](LICENSE).
