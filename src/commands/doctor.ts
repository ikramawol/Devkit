import type { Command } from "commander";
import { CATALOG, CATEGORIES } from "../core/catalog.js";
import { detectItem } from "../core/detect.js";
import { describeMethod } from "../adapters/methods.js";
import { c } from "../utils/logger.js";
import { makeContext } from "./context.js";

export function registerDoctor(program: Command) {
  program
    .command("doctor")
    .alias("list")
    .description("Show every supported tool and whether it's installed (read-only)")
    .option("--json", "output JSON")
    .action((opts: { json?: boolean }) => {
      const ctx = makeContext({});
      const statuses = CATALOG.map((i) => ({ item: i, status: detectItem(i, ctx) }));

      if (opts.json) {
        console.log(JSON.stringify({ platform: ctx.platform, tools: statuses.map((s) => s.status) }, null, 2));
        return;
      }

      console.log(c.bold(`dkit doctor  ${c.dim(`${ctx.platform.os} ${ctx.platform.arch}`)}`));
      for (const cat of CATEGORIES) {
        console.log(`\n${c.bold(cat)}`);
        for (const { item, status } of statuses.filter((s) => s.item.category === cat)) {
          const mark = status.installed ? c.green("✓") : c.red("✗");
          const detail = status.installed ? status.version ?? c.dim("installed") : c.dim("not installed");
          console.log(`  ${mark} ${item.name.padEnd(20)} ${c.dim(item.id.padEnd(12))} ${detail}`);
        }
      }
      const missing = statuses.filter((s) => !s.status.installed).map((s) => s.item.id);
      console.log();
      if (!missing.length) console.log(c.green("Everything is installed."));
      else console.log(`Install missing tools with: ${c.cyan(`dkit install ${missing.join(" ")}`)}  ${c.dim("or just `dkit install` to pick")}`);
    });

  program
    .command("catalog")
    .description("Show how each tool is installed on this OS")
    .option("--check", "Windows: confirm every winget package id exists")
    .action((opts: { check?: boolean }) => {
      const ctx = makeContext({});
      const os = ctx.platform.os;
      for (const item of CATALOG) {
        const m = item.install[os];
        let mark = "";
        if (opts.check && m?.type === "winget") {
          const r = ctx.runner.run("winget", ["show", "--id", m.id, "--exact", "--accept-source-agreements", "--disable-interactivity"]);
          mark = r.ok ? c.green(" ✓ found") : c.red(" ✗ not found in winget");
        }
        console.log(`${item.name.padEnd(20)} ${c.dim(m ? describeMethod(m) : "not supported on this OS")}${mark}`);
      }
    });
}
