import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { checkbox } from "@inquirer/prompts";

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
