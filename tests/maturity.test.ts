import { test } from "node:test";
import assert from "node:assert/strict";
import { CATALOG, getItem } from "../src/core/catalog.js";
import { levelLabel, maturityOf } from "../src/core/maturity.js";
import { EDITORS } from "../src/migrate/editors.js";

test("every resource says what it is and where it lives", () => {
  for (const item of CATALOG) {
    assert.ok(item.description.length > 10, `${item.id} needs a description`);
    if (item.kind === "machine") {
      assert.ok(Object.keys(item.install).length, `${item.id}: a machine tool needs an installer`);
      assert.equal(item.packages, undefined, `${item.id}: machine tools don't add packages to a project`);
    } else {
      assert.ok(item.packages?.deps?.length || item.packages?.dev?.length, `${item.id}: a project library needs packages`);
      assert.deepEqual(item.install, {}, `${item.id}: project libraries use the project's package manager, not an OS installer`);
    }
  }
});

test("project libraries are level 2 on every OS", () => {
  for (const os of ["windows", "macos", "linux"] as const) {
    assert.equal(maturityOf(getItem("hono")!, os).level, 2);
    assert.equal(maturityOf(getItem("drizzle")!, os).level, 2);
  }
});

test("support level is worked out from the catalog entry", () => {
  const git = maturityOf(getItem("git")!, "windows");
  assert.equal(git.level, 2, "discover + install; nothing configures Git yet");
  assert.equal(git.has.snapshot, true, "its config moves with dkit migrate");

  assert.equal(maturityOf(getItem("git-bash")!, "windows").level, 2, "found by path, comes with Git");
  assert.equal(maturityOf(getItem("postman")!, "windows").level, 2);
  // On Linux dkit can neither find Postman nor install it: say so, don't pretend.
  assert.equal(maturityOf(getItem("postman")!, "linux").level, 0);
  assert.equal(levelLabel(0), "Level 0 · Not supported");
});

test("nothing claims to configure or maintain yet", () => {
  for (const item of CATALOG) {
    const m = maturityOf(item, "windows");
    assert.equal(m.has.configure, false, item.id);
    assert.equal(m.has.maintain, false, item.id);
    assert.ok(m.level <= 2, `${item.id} can't be above level 2 without configure`);
  }
});

test("snapshot claims match what dkit migrate really handles", () => {
  // src/migrate/export.ts handles: the editors in editors.ts, Git config, ~/.claude, global npm packages, ~/.ssh/config.
  const handled = new Set([...EDITORS.map((e) => e.id), "git", "claude", "node", "openssh"]);
  const claimed = new Set(CATALOG.filter((i) => i.snapshot?.length).map((i) => i.id));
  assert.deepEqual([...claimed].sort(), [...handled].sort());
});
