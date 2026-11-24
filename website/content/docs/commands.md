---
title: "Command reference"
group: "Reference"
order: 1
---

# Command reference

Every command accepts `--help`. `dkit --version` prints the installed version. Commands that change your machine plan first and ask you to confirm; most accept `--dry-run` and `-y, --yes`.

## Tools

### `dkit doctor`

Show every supported tool and whether it's installed (read-only)

Alias: `dkit list`

| Option | Description |
|---|---|
| `--json` | output JSON |
| `-p, --project <folder>` | also show which libraries this project has (default: the current folder) |

### `dkit catalog`

Show every tool, how it's installed on this OS, and how far dkit supports it

| Option | Description |
|---|---|
| `--check` | Windows: confirm every winget package id exists |

### `dkit info <tool>`

Everything dkit knows about one tool: status, support level, what it needs

| Option | Description |
|---|---|
| `--json` | output JSON |

### `dkit install [tools...]`

Install developer tools, or add libraries to a project. No names = pick from a checklist.

| Option | Description |
|---|---|
| `--all` | install every machine tool in the catalog |
| `-p, --project <folder>` | project to add libraries to (default: the current folder) |
| `--pm <name>` | package manager for a JavaScript project: npm, pnpm, yarn or bun (default: from its lockfile) |
| `--dry-run` | show the plan without changing anything |
| `-y, --yes` | don't ask for confirmation |

### `dkit claude`

Shortcut for `dkit install claude` (adds Git on Windows if needed)

| Option | Description |
|---|---|
| `--dry-run` | show the plan without changing anything |
| `-y, --yes` | don't ask for confirmation |

## Maintain

### `dkit diagnose`

Find what's wrong or out of date: updates, duplicate installs, PATH mistakes (read-only). Exits with code 1 if it found a problem.

| Option | Description |
|---|---|
| `--offline` | skip the update check (it asks winget, Homebrew, apt and npm, which can take a while) |
| `--json` | output JSON |

### `dkit update [tools...]`

Update installed tools with the installer they came from. No names = pick from the ones with updates

| Option | Description |
|---|---|
| `--all` | update every tool that has an update |
| `--dry-run` | show the plan without changing anything |
| `-y, --yes` | don't ask for confirmation (name the tools, or use `--all`) |

### `dkit uninstall <tools...>`

Remove tools with the installer they came from. Your settings and data are left in place

| Option | Description |
|---|---|
| `--dry-run` | show the plan without changing anything |
| `-y, --yes` | don't ask for confirmation |

## Stacks

### `dkit stack list`

Show built-in, saved and team stacks

### `dkit stack info <stack>`

What a stack contains, and what you already have

### `dkit stack install <stack>`

Create a new project from a stack, or add a stack to the project you're in

| Option | Description |
|---|---|
| `-p, --project <folder>` | new folder to create the project in, or an existing project (default: the current folder) |
| `--pm <name>` | package manager for JavaScript stacks: npm, pnpm, yarn, bun (default: the project's, or npm for new projects). Python, Go and Flutter stacks use pip, go get and flutter pub add |
| `--with <ids>` | add tools or libraries, comma-separated (e.g. --with prisma) |
| `--without <ids>` | leave out parts of the stack, comma-separated (e.g. --without drizzle) |
| `--dry-run` | show the plan without changing anything |
| `-y, --yes` | don't ask; keep every component |

### `dkit stack save <id>`

Save your own stack (from an existing one, or from scratch) as a shareable JSON file

| Option | Description |
|---|---|
| `--from <stack>` | start from this stack |
| `--with <ids>` | tools or libraries to add, comma-separated |
| `--without <ids>` | parts of --from to leave out, comma-separated |
| `--starter <id>` | starter for new projects: next, solid, vite-react, hono, nest, node, fastapi, gin, flutter |
| `--name <text>` | display name |
| `--description <text>` | one-line description |
| `--pm <name>` | package manager for new projects |
| `--force` | replace a saved stack with the same id |

## Scan and compare

### `dkit scan`

Describe this machine's setup (tools, versions, extensions, Git preferences) as a portable manifest

| Option | Description |
|---|---|
| `-o, --out <file>` | save the manifest (e.g. dkit-manifest.json) |
| `--json` | print the manifest as JSON |
| `-p, --project <folder>` | also record this project's libraries (default: the current folder, if it's a project) |
| `-f, --force` | overwrite --out if it exists |

### `dkit status [manifest]`

Compare this machine with a manifest (or a migrate backup: .dkit or .json) and offer to install what's missing

| Option | Description |
|---|---|
| `-p, --project <folder>` | project to compare libraries in (default: the current folder) |
| `--pm <name>` | package manager for adding libraries (default: detected from the project) |
| `--check` | only report; exit with code 1 if anything differs (for scripts and CI) |
| `--dry-run` | show what would be installed, change nothing |
| `-y, --yes` | install without asking |

## Migrate

### `dkit migrate export`

Save this machine's setup into one encrypted backup file

| Option | Description |
|---|---|
| `-o, --out <file>` | where to write the backup (a folder, like a USB drive, works too) |
| `--no-encrypt` | don't ask for a password (anyone with the file can read your settings) |
| `-f, --force` | overwrite the file if it exists |

### `dkit migrate inspect <file>`

Show what's in a backup and check it isn't damaged (changes nothing)

### `dkit migrate compare <file>`

Compare a backup with this machine: tools, extensions, settings files (changes nothing)

| Option | Description |
|---|---|
| `-p, --project <folder>` | project to compare libraries in |

### `dkit migrate restore <file>`

Rebuild a setup from a backup file on this machine

| Option | Description |
|---|---|
| `--only <sections>` | comma-separated: tools, apps, editors, git, claude, npm, ssh, shell |
| `--dry-run` | show everything that would change, change nothing |
| `-y, --yes` | accept the defaults without asking |

## Team

### `dkit team init [folder]`

Start a team setup repository: a team file, a baseline from this machine, and your stacks

| Option | Description |
|---|---|
| `--name <text>` | the team's display name, e.g. "Acme web team" (required) |
| `--description <text>` | one line about what this setup is for |
| `--stacks <ids>` | stacks to include, comma-separated (yours, built-in, or other teams') |
| `--no-baseline` | don't create baseline.json from this machine |
| `-f, --force` | replace an existing team file |

### `dkit team add <git-url>`

Connect to a team's setup repository (downloads it to ~/.dkit/teams)

| Option | Description |
|---|---|
| `--name <id>` | short name to use for this team (default: the repository name) |

### `dkit team status [team]`

Compare this machine with your team's baseline and offer to install what's missing

| Option | Description |
|---|---|
| `-p, --project <folder>` | project to compare libraries in (default: the current folder) |
| `--pm <name>` | package manager for adding libraries (default: detected from the project) |
| `--check` | only report; exit with code 1 if anything differs (for scripts and CI) |
| `--offline` | don't fetch the team's latest version first |
| `--dry-run` | show what would be installed, change nothing |
| `-y, --yes` | install without asking |

### `dkit team update [team]`

Get the latest version of your teams' setups (all of them if no name is given)

### `dkit team list`

Show the teams you've added, with their stacks and baseline

Alias: `dkit team ls`

### `dkit team remove <team>`

Disconnect from a team (deletes dkit's copy; the team's repository is untouched)

| Option | Description |
|---|---|
| `-y, --yes` | don't ask |

## Snapshots

### `dkit snapshot schedule`

Turn on automatic snapshots (asks for the password once and keeps it in your OS's secure storage)

| Option | Description |
|---|---|
| `--every <when>` | daily or weekly |
| `--day <day>` | weekly: sun, mon, tue, wed, thu, fri, sat |
| `--time <HH:MM>` | time of day, 24-hour |
| `--keep <n>` | how many snapshots to keep |
| `--folder <dir>` | where to keep them (default: ~/.dkit/snapshots) |

### `dkit snapshot run`

Take a snapshot now

| Option | Description |
|---|---|
| `--quiet` | no output; write the result to ~/.dkit/snapshots.log (used by the schedule) |

### `dkit snapshot list`

Show your snapshots, the schedule, and how the last run went

Alias: `dkit snapshot ls`

### `dkit snapshot unschedule`

Turn automatic snapshots off (your snapshots are kept)

| Option | Description |
|---|---|
| `--forget-password` | also delete the saved password |

## Sync

### `dkit sync init`

Set up sync on this PC: pick the cloud folder and the password every PC shares

| Option | Description |
|---|---|
| `--folder <dir>` | the cloud folder to use (default: found for you) |
| `--name <machine>` | this PC's name in the folder (default: its computer name) |

### `dkit sync push`

Save this PC's setup to the sync folder, so your other PCs can pull it

| Option | Description |
|---|---|
| `--quiet` | no output (for scripts and schedules); exits with 1 on failure |

### `dkit sync status`

Every PC in the sync folder, and how each differs from this one (changes nothing)

### `dkit sync pull`

Bring this PC in line with another PC's setup: compare, pick, confirm. Tools are only ever added

| Option | Description |
|---|---|
| `--from <machine>` | which PC to pull from (default: the one that pushed most recently) |
| `--only <sections>` | comma-separated: tools, apps, editors, git, claude, npm, ssh, shell |
| `--dry-run` | show what would change, change nothing |
| `-y, --yes` | accept the defaults without asking |

### `dkit sync leave`

Stop syncing on this PC: forgets the folder and the saved password

| Option | Description |
|---|---|
| `--delete-my-file` | also delete this PC's file from the sync folder |
