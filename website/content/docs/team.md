---
title: "Team setups"
group: "Guides"
order: 7
---

# Team setups

A team keeps its setup in a Git repository (private is fine). Everyone connects once, and dkit keeps it up to date.

```
dkit-team.json     the team's name and description
baseline.json      what everyone should have (a manifest, made with dkit scan)
stacks/*.json      the team's stacks
```

Whoever sets it up:

```powershell
dkit team init dev-setup --name "Acme web team" --stacks my-api   # baseline from this PC, plus your stacks
# edit dev-setup/baseline.json to keep only what's for everyone, then push it to GitHub
```

Everyone else:

```powershell
dkit team add https://github.com/acme/dev-setup     # or git@github.com:acme/dev-setup.git
dkit team status                  # fetch the latest, compare this PC with the baseline, offer to install what's missing
dkit team status --check          # only report (CI, onboarding scripts)
dkit stack list                   # the team's stacks are listed too
dkit stack install my-api --project app       # or acme/my-api if the id clashes
dkit team update                  # get the latest stacks
dkit team list / dkit team remove dev-setup
```

A team repository gets the same checks as a file from a stranger. Stacks and the baseline can only name catalog tools, libraries and starters. Git settings follow the manifest rules above, and anything that doesn't fit is reported and not used. dkit clones with symlinks turned off and only accepts https, ssh and local Git URLs. Private repositories work when `git clone <url>` works for you.
