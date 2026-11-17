const color = process.stdout.isTTY && !process.env.NO_COLOR;
const wrap = (code: number) => (s: string) => (color ? `\x1b[${code}m${s}\x1b[0m` : s);

export const c = {
  green: wrap(32),
  red: wrap(31),
  yellow: wrap(33),
  cyan: wrap(36),
  dim: wrap(2),
  bold: wrap(1),
};

export interface Logger {
  info(msg: string): void;
  step(msg: string): void;
  ok(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export const logger: Logger = {
  info: (m) => console.log(m),
  step: (m) => console.log(c.cyan("→ ") + m),
  ok: (m) => console.log(c.green("✓ ") + m),
  warn: (m) => console.log(c.yellow("! ") + m),
  error: (m) => console.error(c.red("✗ ") + m),
};

export const silentLogger: Logger = {
  info() {}, step() {}, ok() {}, warn() {}, error() {},
};
