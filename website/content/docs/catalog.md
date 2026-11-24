---
title: "Supported tools"
group: "Reference"
order: 2
---

# Supported tools

Every tool dkit can install, with the installer it uses on each OS. "Manual" means dkit shows you the official download link instead of installing the tool itself. On WSL, Docker is set up through Docker Desktop's WSL integration instead of apt.

## Machine tools (24)

| Group | Tool | id | Windows | macOS | Linux |
|---|---|---|---|---|---|
| Essentials | Git | `git` | winget | brew | apt |
| Essentials | Git Bash | `git-bash` | comes with Git | built in | built in |
| Essentials | OpenSSH | `openssh` | Windows feature (admin prompt) | built in | apt |
| Essentials | GitHub CLI | `gh` | winget | brew | apt |
| Languages | Node.js + npm | `node` | winget (LTS) | brew | apt |
| Languages | Python | `python` | winget (3.13) | brew | apt (+pip, venv) |
| Languages | pnpm | `pnpm` | npm -g | npm -g | npm -g |
| Languages | Yarn | `yarn` | npm -g | npm -g | npm -g |
| Languages | Bun | `bun` | winget | brew | official script |
| Languages | Go | `go` | winget | brew | apt (golang-go) |
| Languages | Flutter | `flutter` | manual (official SDK) | brew cask | manual (official SDK) |
| Editors and AI | VS Code | `vscode` | winget | brew cask | manual download |
| Editors and AI | Antigravity | `antigravity` | winget | manual | manual |
| Editors and AI | Claude Code | `claude` | official script | official script | official script |
| Editors and AI | Codex CLI | `codex` | npm -g | npm -g | npm -g |
| Databases | PostgreSQL 17 | `postgresql` | winget | brew | apt |
| Databases | pgAdmin | `pgadmin` | winget | brew cask | manual |
| Databases | MongoDB | `mongodb` | winget | brew | manual |
| Databases | MongoDB Compass | `compass` | winget | brew cask | manual |
| Databases | Redis | `redis` | winget (Memurai, Redis-compatible) | brew | apt (redis-server) |
| Tools | Docker | `docker` | winget (Docker Desktop) | brew cask | apt (docker.io) |
| Tools | Postman | `postman` | winget | brew cask | manual |
| Tools | Prettier | `prettier` | npm -g | npm -g | npm -g |
| Tools | ESLint | `eslint` | npm -g | npm -g | npm -g |

> **Redis on Windows.** Redis has no official Windows build, so dkit installs Memurai Developer, a free Redis-compatible server for development. It listens on `localhost:6379` like Redis.

## Project libraries (19)

Add these inside a project with `dkit install <id>`. dkit uses the project's own tool, and only adds a library to its own kind of project (see [Project libraries](#libraries)).

| id | Project | Adds |
|---|---|---|
| `hono` | JavaScript | hono |
| `express` | JavaScript | express, dev @types/express |
| `better-auth` | JavaScript | better-auth |
| `kysely` | JavaScript | kysely |
| `pg` | JavaScript | pg, dev @types/pg |
| `drizzle` | JavaScript | drizzle-orm, dev drizzle-kit |
| `prisma` | JavaScript | @prisma/client, dev prisma (kept on the same version) |
| `dbmate` | JavaScript | dev dbmate |
| `ioredis` | JavaScript | ioredis |
| `stripe` | JavaScript | stripe |
| `resend` | JavaScript | resend |
| `fastapi` | Python | fastapi[standard] |
| `sqlalchemy` | Python | sqlalchemy |
| `psycopg` | Python | psycopg[binary] |
| `gin` | Go | github.com/gin-gonic/gin |
| `pgx` | Go | github.com/jackc/pgx/v5 |
| `go-redis` | Go | github.com/redis/go-redis/v9 |
| `flutter-bloc` | Flutter | flutter_bloc |
| `get-it` | Flutter | get_it |

## Project starters (9)

Used with `dkit stack save --starter` or in a stack file.

| id | Project | Creates |
|---|---|---|
| `next` | JavaScript | Next.js (create-next-app: TypeScript, App Router, ESLint, Tailwind) |
| `solid` | JavaScript | SolidJS + Vite + TypeScript |
| `vite-react` | JavaScript | React + TypeScript on Vite (create-vite, react-ts) |
| `hono` | JavaScript | Hono API server (Node.js template, or the Bun template for Bun projects) |
| `nest` | JavaScript | NestJS backend (the official Nest CLI) |
| `node` | JavaScript | An empty Node.js project (just a package.json) |
| `fastapi` | Python | A `.venv`, `requirements.txt` and FastAPI's hello-world `main.py` |
| `gin` | Go | A Go module (`go mod init`) with Gin's hello-world `main.go` |
| `flutter` | Flutter | A Flutter app (`flutter create`) |

## Built-in stacks (12)

| id | What you get |
|---|---|
| `next-drizzle-auth` | Next.js + PostgreSQL + Drizzle + Better Auth |
| `next-hono` | Next.js + Hono + Better Auth + PostgreSQL + Drizzle |
| `solid-hono` | SolidJS + Hono + PostgreSQL + Kysely + dbmate |
| `react-hono` | React + Vite + Hono + PostgreSQL |
| `nest-prisma-redis` | NestJS + PostgreSQL + Prisma + Redis |
| `express-kysely` | Express + PostgreSQL + Kysely |
| `express-prisma` | Express + PostgreSQL + Prisma |
| `hono-api` | Hono API + PostgreSQL + Drizzle |
| `next-saas` | Next.js + Better Auth + Stripe + Resend |
| `fastapi-sqlalchemy` | FastAPI + PostgreSQL + SQLAlchemy |
| `gin-redis` | Go Gin + PostgreSQL + Redis |
| `flutter-bloc` | Flutter + BLoC + GetIt |

See [Stacks](#stacks) for the tools each one installs. For support levels (L1 to L5) see [Installing tools](#install).
