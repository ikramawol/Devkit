# Changelog

## 0.3.0

The biggest release yet: dkit now describes, backs up, syncs and maintains your setup, onboards teams, and starts projects in JavaScript, Python, Go and Flutter.

**Requires Node.js 22 or newer** (Node.js 20 is no longer maintained).

### New commands

- **`dkit stack`**: create a whole project in one command: the tools, the framework's official starter, then your libraries. 12 built-in stacks, plus your own (`dkit stack save`) and your team's.
- **`dkit scan` / `dkit status`**: describe this PC as a portable manifest (tools, versions, editor extensions, npm packages, Git preferences, no personal details), and compare any PC with it. `--check` for CI.
- **`dkit migrate inspect` / `compare`**: see what's in a backup, and how it differs from this PC, without changing anything.
- **`dkit team`**: share a setup through a Git repository (`init`, `add`, `status`, `update`, `list`, `remove`). A new teammate runs two commands.
- **`dkit snapshot`**: automatic encrypted backups, daily or weekly, keeping the last few. The password is kept in Windows DPAPI, the macOS Keychain or the Linux keyring, so the job runs on its own.
- **`dkit sync`**: keep several PCs in step through your cloud folder (OneDrive, Dropbox, Google Drive, iCloud Drive). Encrypted, one file per PC; `pull` only ever adds tools.
- **`dkit diagnose`**: find waiting updates, duplicate installs, tools missing from PATH, and dead PATH folders. Read-only.
- **`dkit update` / `dkit uninstall`**: update or remove tools with the installer they came from (winget, Homebrew, apt, npm). Settings and data are left in place.
- **`dkit info <tool>`**: everything dkit knows about one tool, including its support level.

### More tools, libraries and project types

- **Project libraries**, added with the project's own package manager: Hono, Express, Better Auth, Kysely, Drizzle, Prisma, dbmate, pg, ioredis, Stripe, Resend.
- **Python, Go and Flutter projects**: FastAPI, SQLAlchemy and psycopg (pip inside the project's `.venv`, recorded in `requirements.txt`), Gin, pgx and go-redis (`go get`), flutter_bloc and get_it (`flutter pub add`).
- **New tools**: pnpm, Yarn, Bun, Go, Flutter and Redis (Memurai on Windows), for 24 in total.
- **New stacks**: Next.js + Drizzle + Better Auth, React + Vite + Hono, NestJS + Prisma + Redis, Express + Kysely, Next.js SaaS (Better Auth, Stripe, Resend), FastAPI + SQLAlchemy, Go Gin + Redis, Flutter + BLoC + GetIt, alongside the original four.

### Backups and moving between OSes

- Backups are now one encrypted `.dkit` file (AES-256-GCM). Damaged or tampered files are refused, never half-restored.
- Secret values in settings and shell profiles are replaced with `<REDACTED>` on export; SSH keys are never exported.
- Moving between Windows, macOS and Linux: tools reinstall with the new OS's installer, Git line-ending settings are adjusted, and PowerShell profiles are converted to bash/zsh and back.

### Safer installs

- dkit checks and sets up what a tool needs first, like Windows features and WSL 2 for Docker Desktop.
- Every install, update and restore shows its plan first; `--dry-run` almost everywhere.
- Stack, team and manifest files can only name catalog items, never commands, so a file from someone else can't run anything.

### Fixes

- WSL: Docker comes from Docker Desktop's WSL integration instead of apt; Windows programs showing through on PATH no longer count as Linux tools; VS Code settings are no longer written into Linux, where the Windows editor wouldn't use them.
- `dkit --version` now always matches the installed package.
- Faster `dkit doctor`, and Git Bash is detected reliably.
- JSON files saved with a byte-order mark (Notepad, PowerShell 5) are read correctly.

### Project

- Tests run on Windows, macOS and Linux on every pull request (GitHub Actions).
- A new website with full docs lives in [`website/`](website/).

## 0.2.2

- README updated for the `devsetupkit-cli` package name.

## 0.2.1

- Skip synced skills and backup copies on export.
