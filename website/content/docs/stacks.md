---
title: "Stacks"
group: "Guides"
order: 4
---

# Stacks

A stack is a ready-made combination of tools and libraries. Use it to create a new project, or to add the whole combination to a project you already have. There are stacks for JavaScript, Python, Go and Flutter.

```powershell
dkit stack list                                       # built-in and your own stacks
dkit stack info next-drizzle-auth                     # what's in it, and what you already have

dkit stack install hono-api --project my-api          # new project: tools, then the official starter, then libraries
cd my-shop; dkit stack install solid-hono             # existing project: adds only what's missing
dkit stack install next-hono --project web --without better-auth   # leave parts out, or swap them with --with
dkit stack install fastapi-sqlalchemy --project api   # a Python project with its own .venv
```

## Built-in stacks

### JavaScript

| Stack (id) | Good for | Creates the project with | Tools | Libraries |
|---|---|---|---|---|
| `next-drizzle-auth` | Modern full-stack | create-next-app | Node.js, PostgreSQL | Better Auth, Drizzle, pg |
| `next-hono` | Separate API architecture | create-next-app | Node.js, PostgreSQL | Hono, Better Auth, Drizzle, pg |
| `solid-hono` | Lightweight full-stack | create-solid (Vite + TS) | Node.js, PostgreSQL | Hono, Kysely, pg, dbmate |
| `react-hono` | Separate frontend and backend | create-vite (react-ts) | Node.js, PostgreSQL | Hono, pg |
| `nest-prisma-redis` | Production backend | the Nest CLI (`nest new`) | Node.js, PostgreSQL, Redis | Prisma, ioredis |
| `express-kysely` | Lightweight REST API | your package manager's `init` | Node.js, PostgreSQL | Express, Kysely, pg |
| `express-prisma` | Classic REST API | your package manager's `init` | Node.js, PostgreSQL | Express, Prisma |
| `hono-api` | Backend-only API | create-hono (Node.js template) | Node.js, PostgreSQL | Hono, Drizzle, pg |
| `next-saas` | SaaS development | create-next-app | Node.js | Better Auth, Stripe, Resend |

### Python, Go and Flutter

| Stack (id) | Good for | Tools | Libraries |
|---|---|---|---|
| `fastapi-sqlalchemy` | Python backend | Python, PostgreSQL | FastAPI, SQLAlchemy, psycopg |
| `gin-redis` | Go backend | Go, PostgreSQL, Redis | Gin, pgx, go-redis |
| `flutter-bloc` | Mobile development | Flutter | flutter_bloc, get_it |

How they start: FastAPI gets a `.venv`, `requirements.txt` and a hello-world `main.py`; Gin gets `go mod init` and a hello-world `main.go`; Flutter uses `flutter create`.

> **Tip.** `next-hono` without Better Auth is exactly Next.js + Hono + PostgreSQL + Drizzle: `--without better-auth`. `solid-hono` without dbmate is SolidJS + Hono + PostgreSQL + Kysely: `--without dbmate`. `next-saas` has no database; Better Auth needs one, so add it with `--with postgresql,drizzle,pg`.

## How it works

- **New project** (`--project <new-folder>`): installs the tools that are missing, runs the framework's own official starter without prompts, then adds the libraries with the project's package manager. The folder must not exist yet or be empty.
- **Package manager:** JavaScript stacks use `--pm` (npm by default). Python stacks use pip in `.venv`, Go stacks `go get`, Flutter stacks `flutter pub add`; `--pm` is refused for them.
- **No templates of dkit's own.** Starters are the frameworks' official generators. FastAPI and Gin have none, so dkit writes only the hello-world file from their own tutorials.
- **Existing project** (you're inside one): no starter; only the missing tools and libraries are added.
- Everything is picked by default; untick what you don't want, or use `--without` / `--with`. Already-installed PostgreSQL, Node.js etc. are detected and left alone.
- `--dry-run` shows every command first.

## Your own stacks

```powershell
dkit stack save my-api --from hono-api --without drizzle --with kysely,dbmate
dkit stack save py-api --from fastapi-sqlalchemy --without psycopg
dkit stack save tools-only --with git,node,vscode,docker
dkit stack install my-api --project new-thing
```

Saved stacks are JSON files in `~/.dkit/stacks/`. To share one, send the file; others run `dkit stack install ./my-api.json --project app`. A stack file can only list catalog ids and a starter id: anything else (like a command to run) is refused, so a stack from someone else can't run anything unexpected. A stack also can't mix kinds of project: JavaScript and Python libraries in one stack are refused.
