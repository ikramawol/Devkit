---
title: "Safety and security"
group: "Project"
order: 1
---

# Safety and security

dkit changes your machine, so it is built to be predictable.

## Plan, confirm, act

Installing commands show a plan, ask you to confirm, install, then verify the result. Use `--dry-run` to see the plan without changing anything.

## Updates and uninstalls

- `dkit diagnose` never changes anything.
- `dkit update` and `dkit uninstall` show a plan and ask first; both accept `--dry-run`.
- They only use the installer the tool came from, and leave anything else alone.
- Uninstall removes the program only. Settings, projects and database data stay.
- It warns before removing something another tool needs, and never removes OpenSSH, Python on Linux or parts of the OS.

## Backups

- Encrypted with AES-256-GCM, with the key derived from your password by scrypt. It is built into Node, so nothing extra is installed.
- The password cannot be recovered.
- A damaged or tampered file is refused, not half-restored.
- Secret values (tokens, API keys, passwords) are replaced with `<REDACTED>` on export, including keys set in your shell profile. Restore tells you which to fill back in.
- Never exported: SSH private keys, login sessions, Claude credentials, chat history, database data.
- Every file that would be overwritten is copied to `*.dkit-backup-<time>` first.
- Paths from the old OS are flagged instead of applied.

## Manifests

A manifest leaves out your Git name and email, your computer's name, folder paths and every secret value. Secrets appear by name only. Settings that can start a program (`core.sshCommand`, `core.editor`, `!` aliases) are shown with the command to run yourself, not applied.

## Stacks and team repositories

Stack files and team baselines can only name catalog tools, libraries and starters. Anything else, such as a command to run, is refused, so a file from someone else cannot run anything unexpected. dkit clones team repositories with symlinks turned off and only accepts https, ssh and local Git URLs.

## Snapshots

The password is kept in your OS's secure storage (Windows DPAPI, the macOS Keychain, or the Linux keyring through `secret-tool`) and is never put on a command line. The schedule runs for your user only, with no admin rights.

## Sync

dkit never signs in to a cloud service. It writes encrypted files into a folder your cloud app already syncs, so the cloud only sees encrypted data. The shared password is kept in each PC's secure storage, separate from the snapshot password. `dkit sync pull` shows a plan and asks first, only ever adds tools and extensions, and copies any settings file before replacing it. Conflict copies made by cloud apps are ignored.
