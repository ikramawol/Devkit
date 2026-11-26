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

/**
 * An answer that arrives this soon after the question was printed was typed
 * before it appeared (e.g. Enter pressed while dkit was busy checking tools).
 */
export const STALE_INPUT_MS = 250;

/** One line from the terminal; null if input closed. */
export type ReadLine = (prompt: string) => Promise<string | null>;

const readTerminalLine: ReadLine = (prompt) => {
  const rl = createInterface({ input: stdin, output: stdout });
  return new Promise((resolve) => {
    rl.once("close", () => resolve(null));
    rl.question(prompt).then(resolve, () => resolve(null)).finally(() => rl.close());
  });
};

/**
 * Ask yes/no, defaulting to no. Input typed before the question appeared is
 * ignored and the question is asked again, so a stray Enter can't answer it.
 */
export async function askYesNo(question: string, readLine: ReadLine, now: () => number = Date.now): Promise<boolean> {
  let prompt = `${question} [y/N] `;
  for (let attempt = 0; attempt < 3; attempt++) {
    const shown = now();
    const answer = await readLine(prompt);
    if (answer === null) return false;
    if (now() - shown < STALE_INPUT_MS) {
      prompt = `${question.trim()} [y/N] `;
      continue;
    }
    const a = answer.trim().toLowerCase();
    return a === "y" || a === "yes";
  }
  return false;
}

export function makeConfirm(opts: { yes?: boolean }): Confirm {
  return async (question) => {
    if (opts.yes) return true;
    if (!interactive()) return false; // never hang in CI or piped runs
    return askYesNo(question, readTerminalLine);
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
