import * as assert from "node:assert/strict";
import test from "node:test";
import { config } from "../package.json";
import hooks from "../src/hooks";
import {
  flushComparisonLayouts,
  loadComparisonLayouts,
  writeComparisonLayouts,
} from "../src/services/results/figureGalleryComparisonStore";
import { installMemoryIO } from "./helpers/memoryIO";

test("plugin disable completes cleanup even when saving layouts fails", async () => {
  const globals = globalThis as typeof globalThis & {
    addon: typeof addon;
    ztoolkit: typeof ztoolkit;
  };
  const previousZotero = globalThis.Zotero;
  const previousAddon = globals.addon;
  const previousToolkit = globals.ztoolkit;
  const io = installMemoryIO();
  const errors: Error[] = [];
  let unregistered = false;
  let dialogClosed = false;
  globals.addon = {
    api: { gallery: {} },
    data: {
      alive: true,
      dialog: {
        window: {
          close: () => {
            dialogClosed = true;
          },
        },
      },
    },
  } as unknown as typeof addon;
  globals.ztoolkit = {
    unregisterAll: () => {
      unregistered = true;
    },
  } as unknown as typeof ztoolkit;
  globalThis.Zotero = {
    [config.addonInstance]: globals.addon,
    DataDirectory: { dir: "/data" },
    Prefs: { get: () => undefined },
    logError: (error: Error) => errors.push(error),
  } as unknown as typeof Zotero;
  const write = IOUtils.writeUTF8;
  try {
    await loadComparisonLayouts();
    writeComparisonLayouts({ "1": { label: "pending" } });
    IOUtils.writeUTF8 = async () => {
      throw new Error("disk full");
    };
    await assert.doesNotReject(hooks.onShutdown());
    assert.equal(errors.length, 1);
    assert.equal(unregistered, true);
    assert.equal(dialogClosed, true);
    assert.equal(globals.addon.data.alive, false);
    assert.equal(globals.addon.api.gallery, undefined);
    assert.equal(
      (Zotero as typeof Zotero & Record<string, unknown>)[config.addonInstance],
      undefined,
    );
  } finally {
    IOUtils.writeUTF8 = write;
    await flushComparisonLayouts();
    io.restore();
    globalThis.Zotero = previousZotero;
    globals.addon = previousAddon;
    globals.ztoolkit = previousToolkit;
  }
});
