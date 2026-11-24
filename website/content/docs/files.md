---
title: "Files and paths"
group: "Reference"
order: 3
---

# Files and paths

## Where dkit keeps its files

Everything dkit stores lives in `~/.dkit/`.

| Path | What it holds |
|---|---|
| `~/.dkit/stacks/` | Stacks you saved with `dkit stack save` |
| `~/.dkit/teams/` | Local copies of the teams you added |
| `~/.dkit/snapshots/` | Automatic snapshots (unless you chose another `--folder`) |
| `~/.dkit/snapshots.json` | The snapshot schedule and last run |
| `~/.dkit/snapshots.log` | Results of scheduled runs, including failures |
| `~/.dkit/sync.json` | The sync folder and this PC's name in it |
| `~/.dkit/snapshot-password.dpapi`, `sync-password.dpapi` | Windows: the saved passwords, encrypted with your Windows login (DPAPI) |
| `~/.dkit/snapshot-password`, `sync-password` | Linux with no keyring: the saved passwords, in files only your user can read. macOS and desktop Linux use the Keychain or keyring instead |
| `~/.dkit/converted/` | Shell profile converted between OSes (`profile.sh` or `profile.ps1`) |

## Files dkit creates in your folders

| File | Created by |
|---|---|
| `dkit-manifest.json` | `dkit scan -o dkit-manifest.json` |
| `dkit-backup-<pc>-<date>.dkit` | `dkit migrate export` |
| `snapshot-<pc>-<date>-<time>.dkit` | `dkit snapshot run` and the schedule |
| `*.dkit-backup-<time>` | A copy of any file `dkit migrate restore` would overwrite |
| `dkit-team.json`, `baseline.json`, `stacks/*.json` | `dkit team init` |
| `<cloud folder>/dkit-sync/machines/<pc>.dkit` | `dkit sync init` and `dkit sync push` (one encrypted file per PC) |
| `.venv/`, `requirements.txt` | Python projects: the project's own environment, and the packages dkit added with pip |
| `main.py`, `main.go` | The FastAPI and Gin starters (hello-world files from their tutorials; never overwritten) |

## Environment variables

| Variable | Use |
|---|---|
| `DKIT_BACKUP_PASSWORD` | Supplies the backup password in scripts instead of prompting |
