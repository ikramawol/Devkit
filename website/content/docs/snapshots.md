---
title: "Snapshots"
group: "Guides"
order: 8
---

# Automatic snapshots

Let dkit back up your setup on a schedule, so you always have a recent backup if a PC dies or a change goes wrong.

```powershell
dkit snapshot schedule                       # every day at 12:00, keep the last 7 (asks for a password once)
dkit snapshot schedule --every weekly --day fri --time 18:00 --keep 4 --folder D:\dkit-snapshots
dkit snapshot run                            # take one now
dkit snapshot list                           # snapshots, schedule, how the last run went
dkit snapshot unschedule [--forget-password] # turn it off (snapshots are kept)
```

- **What a snapshot is:** an ordinary encrypted `.dkit` backup, exactly like `dkit migrate export`. Open one with `dkit migrate inspect`, `compare` or `restore`, on any PC, with your password.
- **Pruning:** only the newest `--keep` snapshots are kept. dkit only deletes files it named itself (`snapshot-<pc>-<date>-<time>.dkit`).
- **The password** is kept in your OS's secure storage, so the job can run without asking:
  - **Windows:** DPAPI (encrypted with your Windows login).
  - **macOS:** your Keychain.
  - **Linux:** your keyring through `secret-tool`. On servers or WSL with no keyring, it goes in a file only your user can read, and dkit tells you.
  - It's never put on a command line.
- **The schedule** uses the OS's own scheduler, for your user only, with no admin rights:
  - **Windows:** a Task Scheduler task "dkit snapshot". It runs hidden, and catches up after the PC was off.
  - **macOS:** a launchd agent. It catches up after sleep.
  - **Linux:** a marked line in your crontab.
- **When the job fails**, the result goes to `~/.dkit/snapshots.log`, and `dkit snapshot list` shows it.
- **If you update Node.js or reinstall dkit**, run `dkit snapshot schedule` again so the job points at the new location.
