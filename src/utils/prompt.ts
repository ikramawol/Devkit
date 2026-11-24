import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { checkbox, password, select } from "@inquirer/prompts";

/** Pick one of a list. Without a terminal, the first choice is used. */
export async function chooseOne<T extends string>(message: string, choices: { value: T; name: string }[]): Promise<T> {
  if (!(stdin.isTTY && stdout.isTTY) || choices.length === 1) return choices[0].value;
  return select({ message, choices });
}

export type Confirm = (question: string) => Promise<boolean>;

export interface Choice {
  value: string;
  name: string;
  checked?: boolean;
  /** Shown greyed out and can't be picked (e.g. "installed"). */
  disabled?: string | false;
}
export type Select = (message: string, choices: Choice[]) => Promise<string[]>;

const interactive = () => stdin.isTTY && stdout.isTTY;

export function makeConfirm(opts: { yes?: boolean }): Confirm {
  return async (question) => {
    if (opts.yes) return true;
    if (!interactive()) return false; // never hang in CI or piped runs
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
      return answer === "y" || answer === "yes";
    } finally {
      rl.close();
    }
  };
}

/** Checkbox list. With --yes or no terminal, the pre-checked items are used. */
export function makeSelect(opts: { yes?: boolean }): Select {
  return async (message, choices) => {
    const defaults = choices.filter((c) => c.checked && !c.disabled).map((c) => c.value);
    if (opts.yes || !interactive() || choices.length === 0) return defaults;
    return checkbox({
      message,
      choices: choices.map((c) => ({ value: c.value, name: c.name, checked: c.checked, disabled: c.disabled ?? false })),
      pageSize: 20,
      instructions: " (space = select, a = all, enter = confirm)",
    });
  };
}

// ── Passwords (encrypted backups) ─────────────────────────────

/** For scripts: the backup password can come from this environment variable instead of a prompt. */
export const PASSWORD_ENV = "DKIT_BACKUP_PASSWORD";

export type AskPassword = (message: string) => Promise<string>;

/** Hidden password prompt. Uses DKIT_BACKUP_PASSWORD when set; never hangs without a terminal. */
export function makePassword(env: Record<string, string | undefined> = process.env): AskPassword {
  return async (message) => {
    const fromEnv = env[PASSWORD_ENV];
    if (fromEnv) return fromEnv;
    if (!interactive()) throw new Error(`This needs a password. Set ${PASSWORD_ENV}, or run it in a terminal.`);
    return password({ message, mask: "*" });
  };
}

/** A new password, typed twice. */
export async function askNewPassword(ask: AskPassword, minLength: number, env: Record<string, string | undefined> = process.env): Promise<string> {
  if (env[PASSWORD_ENV]) {
    if (env[PASSWORD_ENV]!.length < minLength) throw new Error(`${PASSWORD_ENV} must be at least ${minLength} characters.`);
    return env[PASSWORD_ENV]!;
  }
  for (;;) {
    const first = await ask(`Password for the backup (at least ${minLength} characters)`);
    if (first.length < minLength) { console.error(`Too short: use at least ${minLength} characters.`); continue; }
    if ((await ask("Type it again")) === first) return first;
    console.error("The passwords don't match. Try again.");
  }
}
