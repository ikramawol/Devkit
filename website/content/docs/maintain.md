---
title: "Diagnose and update"
group: "Guides"
order: 2
---

# Diagnose and update

Keep the tools you already have healthy: find problems, update what's out of date, and remove what you no longer need.

```powershell
dkit diagnose                 # updates waiting, duplicate installs, PATH mistakes (changes nothing)
dkit diagnose --offline       # the same, without the slower update check
dkit update                   # pick from the tools that have updates
dkit update git node          # update these
dkit update --all --dry-run   # see what would be updated
dkit uninstall postman        # remove a tool (asks first; --dry-run to preview)
```

## Find problems

`dkit diagnose` is read-only. It prints what it found and what to do about it, and exits with code 1 if it found a problem, so you can use it in scripts.

```
dkit diagnose  windows x64

Updates
  ↑ Postman              11.18.0 → 11.20.1          winget
  ↑ Node.js + npm        22.11.0 → 22.12.0          winget

Problems
  ✓ None found

Worth knowing
  ! 2 folder(s) on PATH don't exist (usually left behind by an uninstalled app; harmless, but clutter)
      C:\Program Files\OldApp\bin
      C:\tools\old-sdk
      → Edit it in Settings: search "environment variables" → Edit the system environment variables → Environment Variables → Path.

Update with: dkit update postman node  or `dkit update` to pick
```

What it looks for:

- **Updates** that winget, Homebrew, apt or npm know about. apt answers from its last `sudo apt update`.
- **Two copies of a tool** on PATH, and which one runs. On Windows it also catches `python` opening the Microsoft Store instead of your Python.
- **Tools that are installed but not on PATH**, so terminals can't find them. This includes npm's global folder.
- **PATH folders that no longer exist, or are listed twice.** On Windows it checks the saved PATH that new terminals get, not the extra folders your current shell adds.

Findings come in two kinds: **problems** (`✗`), which stop something from working, and **worth knowing** (`!`), which are harmless but worth tidying.

> The update check asks each installer and can take a while. Use `--offline` when you only want the PATH and duplicate checks.

## Update tools

With no names, dkit looks for updates and shows a checklist of the tools that have one. Name tools to update just those, or use `--all` for everything with an update.

```powershell
dkit update postman
```

```
Will update:
  • Postman              11.18.0 → 11.20.1          winget upgrade --id Postman.Postman

? Update 1 tool(s)? y

Summary
  Updated: Postman 11.18.0 → 11.20.1
```

- **It uses the installer the tool came from**: winget, Homebrew, apt or npm.
- **Claude Code updates itself.** `dkit update claude` runs `claude update`, or npm if you installed it from npm.
- **Something you installed another way is left alone**, with a note on how to update it yourself.
- **Project libraries aren't touched.** Use your package manager (`npm update`, `pnpm update`).

## Remove tools

```powershell
dkit uninstall postman --dry-run   # see the plan first
dkit uninstall postman
```

- **Only the program is removed.** Settings, projects and databases' data stay where they are. On Linux, apt shows what it will remove and asks you itself.
- **It warns about tools that would stop working**, for example Prettier without Node.js, and removes tools in a safe order.
- **Some tools are never removed**: OpenSSH, Python on Linux (the system needs it), and anything that's part of the OS. For tools installed with a script, dkit tells you which files to delete.

## Which tools can be maintained

`dkit catalog` marks tools that `dkit update` and `dkit uninstall` handle with `+M`: anything installed with winget, Homebrew, apt or npm. See [Support levels](#install).
