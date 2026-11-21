import os from "node:os";
import path from "node:path";

export type OS = "windows" | "macos" | "linux";

export interface PlatformInfo {
  os: OS;
  arch: string;
  hostname: string;
  home: string;
  /** Windows %APPDATA%; on other OSes the equivalent config root. */
  appData: string;
  /** Where the official Claude Code native installer puts the binary. */
  claudeBinDir: string;
  /** Linux running inside WSL on a Windows PC. */
  wsl?: boolean;
}

/** A Windows program seen from inside WSL (/mnt/c/...): it isn't a Linux tool. */
export const isWindowsSidePath = (p: string) => /^\/mnt\/[a-z]\//i.test(p);

export function detectPlatform(): PlatformInfo {
  const p = process.platform;
  const osName: OS = p === "win32" ? "windows" : p === "darwin" ? "macos" : "linux";
  const home = os.homedir();
  const appData =
    osName === "windows"
      ? process.env.APPDATA ?? path.join(home, "AppData", "Roaming")
      : osName === "macos"
        ? path.join(home, "Library", "Application Support")
        : process.env.XDG_CONFIG_HOME ?? path.join(home, ".config");
  return {
    os: osName,
    arch: process.arch,
    hostname: os.hostname(),
    home,
    appData,
    claudeBinDir: path.join(home, ".local", "bin"),
    wsl: osName === "linux" && (!!process.env.WSL_DISTRO_NAME || /microsoft/i.test(os.release())),
  };
}

/** VS Code and its forks keep settings in <appData>/<dirName>/User on every OS. */
export function editorUserDir(platform: PlatformInfo, dirName: string): string {
  return path.join(platform.appData, dirName, "User");
}
