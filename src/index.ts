#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { Command } from "commander";
import { registerDoctor } from "./commands/doctor.js";
import { registerEnv } from "./commands/env.js";
import { registerInfo } from "./commands/info.js";
import { registerInstall } from "./commands/install.js";
import { registerMaintain } from "./commands/maintain.js";
import { registerMigrate } from "./commands/migrate.js";
import { registerSnapshot } from "./commands/snapshot.js";
import { registerStack } from "./commands/stack.js";
import { registerTeam } from "./commands/team.js";

// dist/index.js → ../package.json (shipped with the npm package), so the version is never out of date.
const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

const program = new Command()
  .name("dkit")
  .description("Set up and migrate your developer environment")
  .version(version);

registerDoctor(program);
registerInfo(program);
registerInstall(program);
registerMaintain(program);
registerStack(program);
registerEnv(program);
registerMigrate(program);
registerTeam(program);
registerSnapshot(program);

program.parseAsync().catch((err: unknown) => {
  // Ctrl+C inside a checklist
  if (err instanceof Error && err.name === "ExitPromptError") process.exit(130);
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
