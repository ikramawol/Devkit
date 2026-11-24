---
title: "Scan and compare"
group: "Guides"
order: 5
---

# Scan and compare

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
