---
title: "Contributing"
group: "Project"
order: 3
---

# Contributing

dkit is open source and MIT licensed. The repository is on [GitHub](https://github.com/ikramawol/Devkit).

```
npm run dev -- doctor     # run without building
npm test                  # tests run on a fake machine; nothing is really installed
```

```
src/
  index.ts              CLI entry
  commands/             doctor, info, install, diagnose/update/uninstall, stack, scan/status, migrate, team, snapshot, sync
  core/catalog.ts       every tool and library: how to find and install it on each OS
  core/detect.ts        is a tool installed?
  core/engine.ts        plan → confirm → install → verify
  core/prereqs.ts       OS prerequisites (Windows features, WSL, ...): check and set up
  core/maturity.ts      support level (L1-L5) per tool, worked out from its catalog entry
  core/project.ts       projects: package.json, package manager, adding libraries
  core/starters.ts      official project starters (create-next-app, create-solid, create-hono, init)
  core/stack.ts         stack recipes: built-ins, validation, save/load, install
  core/team.ts          team setups: a Git repo with stacks and a baseline (add, update, init)
  adapters/methods.ts   winget, brew, apt, npm, scripts
  manifest/             scan this machine, the manifest format, compare and fix (dkit scan / status)
  migrate/              backup format, encrypted .dkit archive, export, inspect/compare, restore,
                        transform.ts: translating settings between OSes
  maintain/             update checks, update/uninstall plans, PATH and duplicate checks (dkit diagnose)
  sync/                 cloud folders, the sync folder: push, read, check the password (dkit sync)
  snapshot/             scheduled snapshots: taking and pruning them, OS schedulers (Task Scheduler, launchd, cron)
  utils/                safe command runner, prompts, logger, secret-store.ts (DPAPI / Keychain / keyring)
```

To add a tool, add one entry to `src/core/catalog.ts` (id, name, kind, description, detect, install). For a project library use `kind: "project"` and `packages: { deps, dev }` instead of detect/install; for a Python, Go or Flutter library add `ecosystem: "python"` (or `"go"`, `"flutter"`) to `packages`. `dkit info <id>` then shows what you've given it.

## License

MIT, see the LICENSE file in the repository.
