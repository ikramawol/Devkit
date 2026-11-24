---
title: "Project libraries"
group: "Guides"
order: 3
---

# Project libraries

Libraries like Hono, FastAPI or Gin belong to a project, not to your computer, so dkit adds them to the project with the project's own tool.

```powershell
cd my-api
dkit install hono kysely dbmate          # adds them to my-api
dkit install drizzle --project ../web    # a different project
dkit install prisma --pm pnpm            # override the package manager (JavaScript projects)
dkit doctor                              # inside a project: also lists which libraries it has
```

## Four kinds of project

dkit tells what kind of project a folder is from its own files, and adds libraries the way that kind of project expects:

| Project | Found by | Libraries are added with |
|---|---|---|
| JavaScript | `package.json` | npm, pnpm, Yarn or Bun |
| Python | `requirements.txt` or `pyproject.toml` | pip, inside the project's `.venv` (created if missing), and recorded in `requirements.txt` |
| Go | `go.mod` | `go get` |
| Flutter | `pubspec.yaml` | `flutter pub add` |

A library only goes into its own kind of project. Asking for Gin in a JavaScript project is refused with a clear message, and nothing runs.

```powershell
cd my-python-api
dkit install fastapi sqlalchemy psycopg   # pip install into .venv, then written to requirements.txt
```

## How it decides

- **Which project:** the folder you're in, or `--project <folder>`. dkit never edits a parent folder's project by accident.
- **Which package manager (JavaScript):** `packageManager` in package.json, else the lockfile (`pnpm-lock.yaml`, `bun.lock`, `yarn.lock`, `package-lock.json`), else npm. If that package manager isn't installed, dkit installs it first (pnpm and Yarn need Node.js; Bun doesn't).
- **Python, Go and Flutter** each have one way to add libraries, so `--pm` doesn't apply. dkit installs Python, Go or Flutter first if it's missing.
- **Python packages never touch your system Python.** They go into the project's `.venv`, which dkit creates with `python -m venv .venv` when there isn't one.
- Only missing libraries are added, regular and dev dependencies in one command each, and the result is checked against the project's own files.
- Machine tools and libraries can be mixed: `dkit install gh hono`.

## Every library

| Group | Libraries (id) |
|---|---|
| JavaScript frameworks | Hono (`hono`), Express (`express` + dev @types/express) |
| JavaScript databases | Kysely (`kysely`), Drizzle ORM (`drizzle`: drizzle-orm + dev drizzle-kit), Prisma (`prisma`: @prisma/client + dev prisma at the same version), dbmate (`dbmate`, dev), node-postgres (`pg` + dev @types/pg), ioredis (`ioredis`) |
| Auth | Better Auth (`better-auth`) |
| Payments and email | Stripe (`stripe`), Resend (`resend`) |
| Python | FastAPI (`fastapi`: fastapi[standard]), SQLAlchemy (`sqlalchemy`), psycopg (`psycopg`: psycopg[binary]) |
| Go | Gin (`gin`), pgx (`pgx`), go-redis (`go-redis`) |
| Flutter | flutter_bloc (`flutter-bloc`), get_it (`get-it`) |

> **Windows note.** With Smart App Control (or a company policy) turned on, Windows can block Python packages that include compiled parts, such as SQLAlchemy and psycopg: `ImportError: DLL load failed ... An Application Control policy has blocked this file`. That's a Windows security setting, not dkit; the project is set up correctly.
