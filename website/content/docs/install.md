---
title: "Installing tools"
group: "Guides"
order: 1
---

# Installing tools

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

## System prerequisites

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

## Support levels

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
- `+M`: `dkit update` and `dkit uninstall` handle it (anything installed with winget, Homebrew, apt or npm). See [Diagnose and update](#maintain).

| Group | Tools (id) |
|---|---|
| Essentials | Git (`git`), Git Bash (`git-bash`), OpenSSH (`openssh`), GitHub CLI (`gh`) |
| Languages | Node.js + npm (`node`), Python (`python`), pnpm (`pnpm`), Yarn (`yarn`), Bun (`bun`), Go (`go`), Flutter (`flutter`) |
| Editors & AI | VS Code (`vscode`), Antigravity (`antigravity`), Claude Code (`claude`), Codex CLI (`codex`) |
| Databases | PostgreSQL 17 (`postgresql`), pgAdmin (`pgadmin`), MongoDB (`mongodb`), MongoDB Compass (`compass`), Redis (`redis`; on Windows: Memurai, a Redis-compatible server) |
| Tools | Docker (`docker`), Postman (`postman`), Prettier (`prettier`), ESLint (`eslint`) |

Windows uses winget (plus the official Claude Code installer and npm). macOS uses Homebrew. Linux uses apt; tools with no apt package show a download link.
