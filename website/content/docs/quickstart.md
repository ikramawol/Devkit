---
title: "Quick start"
group: "Getting started"
order: 2
---

# Quick start

From a fresh install to a restored machine, using only real commands.

## 1. Install dkit

```powershell
npm install -g devsetupkit-cli
```

## 2. See what you have

```powershell
dkit doctor          # what's installed, what's missing (changes nothing)
```

## 3. Install what is missing

```powershell
dkit install                     # checklist: pick with space, confirm with enter
dkit install git node claude     # or name the tools
dkit install --all --dry-run     # preview everything, change nothing
```

## 4. Save your setup

```powershell
dkit scan -o dkit-manifest.json  # a manifest you can commit or share
dkit migrate export              # encrypted backup, asks for a password
```

> **Note.** The backup password cannot be recovered. Without it the backup cannot be opened.

## 5. Restore on the next machine

```powershell
npm install -g devsetupkit-cli
dkit migrate inspect dkit-backup-....dkit             # what's inside, is it intact
dkit migrate restore dkit-backup-....dkit --dry-run   # see every change first
dkit migrate restore dkit-backup-....dkit             # pick sections, then apply
```

## 6. Keep a backup automatically

```powershell
dkit snapshot schedule           # daily at 12:00, keep the last 7
```

## 7. Keep your tools up to date

```powershell
dkit diagnose                    # updates waiting, PATH problems (changes nothing)
dkit update                      # pick from the tools that have updates
```

## 8. Keep two PCs the same

```powershell
dkit sync init                   # on each PC: pick your cloud folder, same password
dkit sync pull                   # bring over what your other PC has
```

Next: read the guides for [diagnose and update](#maintain), [stacks](#stacks), [team setups](#team), [snapshots](#snapshots) and [sync](#sync).
