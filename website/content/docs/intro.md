---
title: "Introduction"
group: "Getting started"
order: 1
---

# Introduction

dkit is a command line tool that sets up a developer machine and moves your whole setup to a new PC or OS. The npm package is `devsetupkit-cli`; the command it installs is `dkit`.

## What it does

- **Installs tools.** Git, Node.js, Python, Go, Flutter, Docker, PostgreSQL, Redis, VS Code, Claude Code and more, using your OS's own installer.
- **Starts projects.** Stacks create a JavaScript, Python, Go or Flutter project from the framework's official starter and add the libraries you want.
- **Describes your setup.** A manifest lists your tools, extensions and preferences so you can compare any PC with it.
- **Moves you to a new machine.** One encrypted `.dkit` file carries your setup between Windows, macOS and Linux.
- **Onboards teams.** A team keeps its baseline and stacks in a Git repo; a new teammate runs two commands.
- **Keeps tools healthy.** `dkit diagnose` finds updates and PATH problems; `dkit update` and `dkit uninstall` use the installer each tool came from.
- **Backs up on a schedule.** Snapshots are encrypted backups taken automatically.
- **Keeps your PCs in step.** `dkit sync` shares each PC's setup through your cloud folder (OneDrive, Dropbox, Google Drive, iCloud), encrypted, so your other PCs can catch up.

## How it works

dkit follows one rule: **plan, confirm, act.** It shows what it will do, asks you to confirm, does it, then checks the result. Nothing is installed unless you pick it, and `--dry-run` is available on almost every command that changes something.

## Requirements and platforms

- Node.js 22 or newer.
- Windows (winget, PowerShell), macOS (Homebrew) or Linux on Debian/Ubuntu (apt), including WSL.

## Where to go next

- [Quick start](#quickstart) for the five-minute tour.
- [Installation](#setup) for install, update and building from source.
- [Command reference](#commands) for every command and option.
- [Safety and security](#safety) for what dkit never exports or runs.
