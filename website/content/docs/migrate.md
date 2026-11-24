---
title: "Migrate"
group: "Guides"
order: 6
---

# Migrate to a new PC or OS

On the old machine:

```powershell
dkit migrate export              # asks for a password, writes dkit-backup-<pc>-<date>.dkit
dkit migrate export -o E:\       # straight to a USB drive
```

Copy the file to the new machine, then:

```powershell
dkit migrate inspect dkit-backup-....dkit             # what's inside, and is it intact (changes nothing)
dkit migrate compare dkit-backup-....dkit             # what differs on this PC: tools, extensions, settings files
dkit migrate restore dkit-backup-....dkit --dry-run   # see every change first
dkit migrate restore dkit-backup-....dkit             # pick sections, then apply
dkit migrate restore backup.dkit --only editors,git   # just some sections
```

The backup is one compressed, **encrypted** file:

- **Encryption:** AES-256-GCM, with the key derived from your password by scrypt. It's built into Node, so there's nothing extra to install.
- **The password can't be recovered.** Without it the backup can't be opened.
- **Damage and tampering:** any change to the file is detected and the backup is refused, rather than half-restored.
- **Scripts:** set `DKIT_BACKUP_PASSWORD` instead of typing the password. `--no-encrypt` makes an unencrypted (still compressed and checksummed) file.
- **Old backups:** `.json` backups from dkit 0.2 still restore.

What's carried over:

| Section | Contents |
|---|---|
| `tools` | Every catalog tool you had, reinstalled with the new OS's installer |
| `apps` | Other apps winget knows about (Windows → Windows, none preselected) |
| `editors` | VS Code and Antigravity extensions, settings, keybindings, tasks, snippets |
| `git` | Global Git config and global gitignore |
| `claude` | `~/.claude` settings, CLAUDE.md, commands, agents, skills, output styles, user MCP servers |
| `npm` | Global npm packages |
| `ssh` | `~/.ssh/config` (never keys) |
| `shell` | PowerShell profile, or .bashrc/.zshrc (only restored on a matching OS) |

Moving between Windows, macOS and Linux:

- **Tools:** reinstalled with the new OS's installer (winget ↔ Homebrew ↔ apt). Tools with no installer there are listed for you to install.
- **Shell profile:** a PowerShell profile can't run on macOS or Linux, and a .bashrc/.zshrc can't run on Windows. dkit converts environment variables and simple aliases into `~/.dkit/converted/profile.sh` (or `profile.ps1`), and tells you the one line to add to your own profile to load it. Anything more complex is left out and counted, not guessed.
- **Git:** `core.autocrlf` becomes the new OS's usual setting (`true` on Windows, `input` elsewhere). Windows-only editors like Notepad++ aren't set on macOS or Linux.
- **MCP servers and settings that point at the old OS's folders** (like `C:\Tools\mcp.exe`) are listed for you instead of being applied.

On Linux, apt installs use `sudo`, or run directly when you're root (in containers, for example). Inside WSL, Windows programs on the PATH (`/mnt/c/...`) don't count as Linux tools, except VS Code and Antigravity, which you use from Windows.

Safety rules:

- Secret values (tokens, API keys, passwords) are replaced with `<REDACTED>` on export, including keys set in your shell profile (`$env:OPENAI_API_KEY = "..."`, `export GITHUB_TOKEN=...`); restore tells you which to fill back in
- Never exported: SSH private keys, login sessions, Claude credentials, chat history, database data
- Every file that would be overwritten is copied to `*.dkit-backup-<time>` first
- Every file has a checksum; a damaged backup is refused
- Paths from the old OS (like `C:\Tools\vim.exe` on Linux) are flagged instead of applied
