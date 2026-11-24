import path from "node:path";
import { detectPlatform } from "../core/platform.js";
import type { EngineContext, ProjectTarget } from "../core/engine.js";
import { PACKAGE_MANAGERS, readProject, type NodePackageManager, type PackageManager } from "../core/project.js";
import { logger } from "../utils/logger.js";
import { makeConfirm, makeSelect } from "../utils/prompt.js";
import { systemRunner } from "../utils/run.js";

export interface CommonOpts {
  dryRun?: boolean;
  yes?: boolean;
}

export interface ProjectOpts {
  project?: string;
  pm?: string;
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

/** The project libraries go into: --project, or else the current folder (only if it's a project). */
export function resolveProject(opts: ProjectOpts): ProjectTarget {
  if (opts.pm && !PACKAGE_MANAGERS.includes(opts.pm as NodePackageManager)) {
    throw new Error(`Unknown package manager "${opts.pm}". Use one of: ${PACKAGE_MANAGERS.join(", ")}.`);
  }
  const projectDir = path.resolve(opts.project ?? ".");
  const project = readProject(projectDir, { pm: opts.pm as PackageManager | undefined }) ?? undefined;
  return { projectDir, project };
}
