#!/usr/bin/env node
import { Command } from "commander";
import { registerDoctor } from "./commands/doctor.js";
import { registerInstall } from "./commands/install.js";
import { registerMigrate } from "./commands/migrate.js";

const program = new Command()
  .name("dkit")
  .description("Set up and migrate your developer environment")
  .version("0.2.0");

registerDoctor(program);
registerInstall(program);
registerMigrate(program);

program.parseAsync().catch((err: unknown) => {
  // Ctrl+C inside a checklist
  if (err instanceof Error && err.name === "ExitPromptError") process.exit(130);
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
