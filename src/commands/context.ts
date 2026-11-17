import { detectPlatform } from "../core/platform.js";
import type { EngineContext } from "../core/engine.js";
import { logger } from "../utils/logger.js";
import { makeConfirm, makeSelect } from "../utils/prompt.js";
import { systemRunner } from "../utils/run.js";

export interface CommonOpts {
  dryRun?: boolean;
  yes?: boolean;
}

export function makeContext(opts: CommonOpts): EngineContext & { select: ReturnType<typeof makeSelect> } {
  return {
    runner: systemRunner,
    platform: detectPlatform(),
    log: logger,
    confirm: makeConfirm({ yes: opts.yes }),
    select: makeSelect({ yes: opts.yes }),
    dryRun: !!opts.dryRun,
  };
}
