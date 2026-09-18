import * as assert from "node:assert/strict";
import test from "node:test";
import {
  flushComparisonLayouts,
  loadComparisonLayouts,
  readComparisonLayouts,
  writeComparisonLayouts,
} from "../src/services/results/figureGalleryComparisonStore";
import { installMemoryIO, type MemoryIOHarness } from "./helpers/memoryIO";

const STORE_PATH = "/data/zotero-figure/comparison-layouts.json";

interface StoreHarness {
  io: MemoryIOHarness;
  prefs: Map<string, unknown>;
  restore(): void;
}

function installStore(): StoreHarness {
  const previousZotero = globalThis.Zotero;
  const io = installMemoryIO();
  const prefs = new Map<string, unknown>();
  globalThis.Zotero = {
    DataDirectory: { dir: "/data" },
    Prefs: {
      clear: (key: string) => prefs.delete(key),
      get: (key: string) => prefs.get(key),
      set: (key: string, value: unknown) => prefs.set(key, value),
    },
    logError: () => undefined,
  } as unknown as typeof Zotero;
  return {
    io,
    prefs,
    restore: () => {
      io.restore();
      globalThis.Zotero = previousZotero;
    },
  };
}

test("keeps comparison layouts in the data directory rather than a preference", async () => {
  const harness = installStore();
  try {
    await loadComparisonLayouts();
    assert.deepEqual(readComparisonLayouts(), {});

    writeComparisonLayouts({ "1": { version: 3 } });
    assert.deepEqual(readComparisonLayouts(), { "1": { version: 3 } });

    await flushComparisonLayouts();
    assert.equal(
      harness.io.readText(STORE_PATH),
      JSON.stringify({ "1": { version: 3 } }),
    );
    assert.equal(harness.prefs.size, 0);

    await loadComparisonLayouts();
    assert.deepEqual(readComparisonLayouts(), { "1": { version: 3 } });
  } finally {
    harness.restore();
  }
});

test("migrates a legacy preference payload and clears the preference", async () => {
  const harness = installStore();
  const legacy = { "1": { documentOrder: [3, 1], rows: [], version: 3 } };
  harness.prefs.set(
    "extensions.zotero.zoterofigure.galleryComparisonLayouts",
    JSON.stringify(legacy),
  );
  try {
    await loadComparisonLayouts();
    assert.deepEqual(readComparisonLayouts(), legacy);
    assert.equal(harness.io.readText(STORE_PATH), JSON.stringify(legacy));
    assert.equal(harness.prefs.size, 0);
  } finally {
    harness.restore();
  }
});

test("falls back to an empty store when persisted layouts are malformed", async () => {
  const harness = installStore();
  harness.io.writeText(STORE_PATH, "not json");
  try {
    await loadComparisonLayouts();
    assert.deepEqual(readComparisonLayouts(), {});
  } finally {
    harness.restore();
  }
});

test("persists layouts far larger than the Gecko preference ceiling", async () => {
  const harness = installStore();
  try {
    await loadComparisonLayouts();
    // One cell per figure per document; a few hundred documents already
    // exceeds MAX_PREF_LENGTH (1MB), which is why this is not a preference.
    const rows = Array.from({ length: 2000 }, (_unused, row) => ({
      entries: Object.fromEntries(
        Array.from({ length: 40 }, (_cell, column) => [
          String(column),
          {
            entryIDs: [`1:KEY${column}:${row}`],
            primaryEntryID: `1:KEY${column}:${row}`,
          },
        ]),
      ),
      id: `comparison-row-${row}`,
      isGroup: false,
      label: "",
    }));
    writeComparisonLayouts({
      "1": { documentOrder: [1], rows, version: 3 },
    });
    await flushComparisonLayouts();

    const serialized = harness.io.readText(STORE_PATH);
    assert.ok(serialized, "expected the store file to exist");
    assert.ok(
      serialized.length > 1024 * 1024,
      `expected a payload above 1MB, saw ${serialized.length}`,
    );
    assert.equal(harness.prefs.size, 0);
  } finally {
    harness.restore();
  }
});
