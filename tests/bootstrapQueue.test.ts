import * as assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { runInNewContext } from "node:vm";

function harness(version = "11.0-beta.4", reason = 1) {
  let resolveUI!: () => void;
  let rejectUI!: (error: unknown) => void;
  const uiReady = new Promise<void>((resolve, reject) => {
    resolveUI = resolve;
    rejectUI = reject;
  });
  const events: string[] = [];
  const errors: unknown[] = [];
  const Zotero = {
    version,
    logError: (error: unknown) => errors.push(error),
    __addonInstance__: {
      hooks: {
        async onStartup() {
          events.push("waiting-for-ui");
          await uiReady;
          events.push("features-ready");
        },
      },
    },
  };
  const context = {
    Zotero,
    Components: {
      classes: {
        "@mozilla.org/addons/addon-manager-startup;1": {
          getService: () => ({ registerChrome: () => ({}) }),
        },
      },
      interfaces: {},
    },
    Services: {
      io: { newURI: (uri: string) => uri },
      scriptloader: {
        loadSubScript() {},
        loadSubScriptWithOptions() {},
      },
    },
  };
  runInNewContext(readFileSync("addon/bootstrap.js", "utf8"), context);
  const startup = (
    context as typeof context & {
      startup(data: { rootURI: string }, reason: number): Promise<void>;
    }
  ).startup({ rootURI: "file:///test-addon/" }, reason);
  return { startup, resolveUI, rejectUI, events, errors };
}

test("Zotero 11 cold startup releases the plugin queue before library UI readiness", async () => {
  const h = harness();
  let nextPluginStarted = false;
  const queue = h.startup.then(() => {
    nextPluginStarted = true;
    // A later plugin can now load the background library without selecting it.
    h.resolveUI();
  });
  await setImmediate();
  assert.equal(nextPluginStarted, true);
  await queue;
  await setImmediate();
  assert.deepEqual(h.events, ["waiting-for-ui", "features-ready"]);
  assert.deepEqual(h.errors, []);
});

for (const [version, reason] of [
  ["10.0.0", 1],
  ["11.0", 3],
  ["11.0", 7],
] as const) {
  test(`Zotero ${version}, reason ${reason} preserves awaited startup`, async () => {
    const h = harness(version, reason);
    let settled = false;
    const startup = h.startup.then(() => {
      settled = true;
    });
    await setImmediate();
    assert.equal(settled, false);
    h.resolveUI();
    await startup;
    assert.equal(settled, true);
    assert.deepEqual(h.errors, []);
  });
}

test("background startup reports failures without rejecting the Zotero 11 plugin queue", async () => {
  const h = harness();
  await h.startup;
  const error = new Error("UI startup failed");
  h.rejectUI(error);
  await setImmediate();
  assert.deepEqual(h.errors, [error]);
});

test("awaited enable startup still propagates failures to Zotero", async () => {
  const h = harness("11.0", 3);
  const error = new Error("enable failed");
  h.rejectUI(error);
  await assert.rejects(h.startup, (caught: unknown) => caught === error);
});

test("disabled addon does not resume UI startup when readiness resolves", async () => {
  let resolveUI!: () => void;
  const ready = new Promise<void>((resolve) => {
    resolveUI = resolve;
  });
  const addon = { data: { alive: true } };
  const Zotero = {
    initializationPromise: Promise.resolve(),
    unlockPromise: Promise.resolve(),
    uiReadyPromise: ready,
  };
  const source = readFileSync("src/hooks.ts", "utf8");
  const start = source.indexOf("async function onStartup");
  const guard = source.indexOf("if (!addon.data.alive) return;", start);
  assert.ok(guard > start);
  let prefix = source.slice(
    start,
    guard + "if (!addon.data.alive) return;".length,
  );
  prefix = prefix.replace(/\): Promise<void>/g, ")");
  const context = {
    addon,
    Zotero,
    waitForZotero: () => ready,
    installMarkdownSnapshotOpenPatch: () => () => {},
    reached: false,
  };
  runInNewContext(
    "let removeMarkdownSnapshotOpenPatch;" + prefix + "reached = true; }",
    context,
  );
  const pending = (
    context as typeof context & { onStartup(): Promise<void> }
  ).onStartup();
  addon.data.alive = false;
  resolveUI();
  await pending;
  assert.equal(context.reached, false);
});
