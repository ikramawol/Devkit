---
title: "Sync your PCs"
group: "Guides"
order: 9
---

# Sync your PCs

Keep a laptop and a desktop in step through a cloud folder: OneDrive, Dropbox, Google Drive or iCloud Drive. The PCs can run Windows, macOS or Linux, in any mix. dkit only writes files into the folder, and your cloud app uploads them. dkit never signs in to anything.

```powershell
dkit sync init          # first PC: finds your cloud folder, you choose a password
dkit sync init          # each other PC: same cloud account, same password
dkit sync push          # after you change your setup: save this PC's setup
dkit sync status        # every PC, and how each differs from this one
dkit sync pull          # compare with the PC that pushed last, pick what to bring over
dkit sync leave         # stop syncing on this PC
```

## Set it up

On your first PC, `dkit sync init` looks for a cloud folder and creates `dkit-sync` inside it. You choose a password that every PC will share.

```
Using C:\Users\you\OneDrive
Creating C:\Users\you\OneDrive\dkit-sync
Password for the backup (at least 8 characters): ********
✓ Sync is set up. This PC is "laptop".
  Folder       C:\Users\you\OneDrive\dkit-sync
  Password in  Windows DPAPI (encrypted with your Windows login)
  Saved        C:\Users\you\OneDrive\dkit-sync\machines\laptop.dkit
```

On each other PC, sign in to the same cloud account and run `dkit sync init` again. dkit finds the existing folder, asks for the password, and checks it against the files already there before saving anything.

- **Several cloud folders?** dkit asks which one to use.
- **No folder found, or you want another one?** Use `--folder <path>`, for example in WSL: `--folder /mnt/c/Users/<you>/OneDrive`.
- **Two PCs with the same computer name?** dkit notices and asks you to pick one with `--name`, for example `--name desktop`.

> **Note.** The password cannot be recovered. Every PC needs the same one to read the others' files.

## Push and pull

`dkit sync push` saves this PC's setup as one encrypted file. Run it after you install tools, add extensions or change settings.

`dkit sync status` shows every PC in the folder and how many differences each has from the one you're on:

```
Sync folder  C:\Users\you\OneDrive\dkit-sync
This PC      laptop  last pushed 24/11/2026, 10:06

  ≠ desktop    linux    24/11/2026, 10:07  5 difference(s): dkit sync pull --from desktop
  ● laptop     windows  24/11/2026, 10:06  this PC
```

`dkit sync pull` compares this PC with the one that pushed most recently, or with `--from <pc>`. It shows the differences, lets you pick what to bring over, and asks before writing anything. Preview it with `--dry-run`, or limit it with `--only tools,editors`.

```powershell
dkit sync pull --from desktop --dry-run
dkit sync pull --only tools,editors
```

## How it stays safe

- **One encrypted file per PC.** Each PC writes `dkit-sync/machines/<pc-name>.dkit`, the same encrypted backup as `dkit migrate export`. The cloud only ever sees encrypted data; file names are the PCs' names, nothing more.
- **The password stays on each PC.** It's kept in that PC's secure storage (DPAPI, the Keychain or the keyring), so you type it once per PC. It's separate from the snapshot password.
- **Pull only adds tools and extensions.** Nothing is uninstalled because another PC doesn't have it. A settings file that gets replaced is copied first.
- **Different OSes work.** Tools are installed with this OS's installer and settings are translated, like `dkit migrate restore`.
- **Half-synced files are never read.** Files are written in one step, and a cloud app's conflict copies (like `laptop (1).dkit`) are ignored.

## Stop syncing

```powershell
dkit sync leave                   # forget the folder and the saved password on this PC
dkit sync leave --delete-my-file  # also remove this PC's file from the folder
```

The other PCs keep syncing with each other.
