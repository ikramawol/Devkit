---
title: "Installation"
group: "Getting started"
order: 3
---

# Installation

Needs Node.js 22 or newer.

```powershell
npm install -g devsetupkit-cli
```

The package is called `devsetupkit-cli`; the command it installs is **`dkit`**:

```powershell
dkit doctor          # see what's installed
dkit --help          # all commands
```

Update with `npm install -g devsetupkit-cli@latest`, remove with `npm uninstall -g devsetupkit-cli`.

> **Coming soon: install without Node.js.** We're building a one-line installer that sets up dkit on a brand-new computer, with nothing to install first. Stay tuned.

## Setup from source

Build dkit from the repository (the original instructions target Windows and PowerShell):

```powershell
git clone https://github.com/ikramawol/Devkit.git
cd Devkit
npm install
npm run build
npm link          # makes `dkit` available everywhere
```
