---
title: "Troubleshooting"
group: "Project"
order: 2
---

# Troubleshooting

## A tool will not install because of a missing prerequisite

`dkit doctor` and `dkit install` list what a tool needs first. Items marked `○` are set up by dkit (each shows a Windows admin prompt and may need a restart). Items marked `✗`, such as turning on virtualization in the BIOS or updating Windows, you must do yourself; dkit will not install the tool until they are fixed.

## I forgot my backup password

It cannot be recovered. Without the password the backup cannot be opened, so export a new one from a machine you can still use.

## Scheduled snapshots stopped working

If you update Node.js or reinstall dkit, run `dkit snapshot schedule` again so the job points at the new location. Check `~/.dkit/snapshots.log` or `dkit snapshot list` to see how the last run went.

## A tool is installed but the terminal can't find it

Run `dkit diagnose`. It shows tools that are installed but not on PATH (including npm's global folder), two copies of the same tool, and on Windows `python` opening the Microsoft Store. Each finding says how to fix it. Open a new terminal after changing PATH.

## dkit won't update or uninstall a tool

dkit only updates and removes tools through the installer they came from (winget, Homebrew, apt or npm). A tool you installed another way is left alone, and dkit tells you how to handle it yourself. OpenSSH, Python on Linux and anything that's part of the OS are never removed.

## Sync can't find my cloud folder

`dkit sync init` looks for OneDrive, Dropbox, Google Drive and iCloud Drive in their usual places. If yours is somewhere else, or you're in WSL, name it: `dkit sync init --folder <path>`. If `dkit sync push` says the folder isn't there, check that the cloud app is running and signed in.

## "That password doesn't open the files in this sync folder"

Every PC must use the password chosen on the first PC. It can't be recovered; if it's lost, run `dkit sync leave` on each PC, delete the `dkit-sync` folder and start again with `dkit sync init`.

## dkit says a tool is "manual"

The tool has no installer dkit can use on your OS, so it shows the official download link. See [Supported tools](#catalog).

## Libraries went into the wrong project

dkit uses the folder you are in, or `--project <folder>`, and never edits a parent folder's project. The folder must be a project: `package.json` (JavaScript), `requirements.txt` or `pyproject.toml` (Python), `go.mod` (Go) or `pubspec.yaml` (Flutter). Use `--pm` to override the package manager of a JavaScript project.

## "...libraries, but ... is a JavaScript project, so they're left out"

A library only goes into its own kind of project: Gin into a Go project, FastAPI into a Python project. Run the command inside the right project, or use `--project <folder>`.

## Python packages fail to load on Windows

`ImportError: DLL load failed ... An Application Control policy has blocked this file` comes from Windows Smart App Control (or a company policy), which blocks packages with compiled parts such as SQLAlchemy and psycopg. It's a Windows security setting, not dkit; the project itself is set up correctly.

## A stack file is refused

Stack files may only list catalog ids and a starter id. A field such as a command to run is rejected on purpose. See [Safety and security](#safety).

## Behaviour on WSL

Docker is set up through Docker Desktop's WSL integration instead of apt. Windows programs on the PATH (`/mnt/c/...`) do not count as Linux tools, except VS Code and Antigravity, which you use from Windows.

## Using dkit in CI

`dkit status <manifest> --check` and `dkit team status --check` only report, and exit with code 1 if anything differs.
