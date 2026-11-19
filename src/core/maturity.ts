import type { OS } from "./platform.js";
import type { CatalogItem } from "./catalog.js";

/**
 * How far dkit's support for a resource goes, on one OS. Worked out from what the
 * catalog entry actually defines, so a resource is never shown as more supported than it is.
 */
export const LEVELS = [
  { level: 1, key: "discover", label: "Discover", means: "tells whether it's installed" },
  { level: 2, key: "install", label: "Install", means: "installs it with this OS's installer" },
  { level: 3, key: "configure", label: "Configure", means: "applies settings for you" },
  { level: 4, key: "snapshot", label: "Snapshot & restore", means: "`dkit migrate` saves and restores its settings" },
  { level: 5, key: "maintain", label: "Maintain", means: "updates, uninstalls and diagnoses it" },
] as const;

export type Capability = (typeof LEVELS)[number]["key"];

export interface Maturity {
  /** Highest level reached with every level below it also supported (0 = not even discoverable). */
  level: number;
  has: Record<Capability, boolean>;
}

export function maturityOf(item: CatalogItem, os: OS): Maturity {
  const { command, commandOn, paths } = item.detect;
  const method = item.install[os];
  const has: Record<Capability, boolean> = {
    discover:
      (!!command && (!commandOn || commandOn.includes(os))) ||
      !!paths?.[os]?.length ||
      (os === "windows" && method?.type === "winget"), // winget can always tell
    install: !!method && method.type !== "manual",
    configure: false, // no resource applies settings yet
    snapshot: !!item.snapshot?.length,
    maintain: false, // no update/uninstall yet
  };
  let level = 0;
  for (const l of LEVELS) {
    if (!has[l.key]) break;
    level = l.level;
  }
  return { level, has };
}

export const levelLabel = (level: number) =>
  level === 0 ? "Level 0 · Not supported" : `Level ${level} · ${LEVELS[level - 1].label}`;
