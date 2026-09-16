import * as assert from "node:assert/strict";
import test from "node:test";
import type { FigureGalleryComparisonLayout } from "../src/domain/figureGallery";
import { loadComparisonLayouts } from "../src/services/results/figureGalleryComparisonStore";
import {
  getFigureGalleryComparisonLayout,
  getFigureGalleryImageScale,
  getFigureGalleryViewMode,
  setFigureGalleryComparisonLayout,
  setFigureGalleryImageScale,
  setFigureGalleryViewMode,
} from "../src/services/results/figureGalleryPreferences";
import { installMemoryIO, type MemoryIOHarness } from "./helpers/memoryIO";

const STORE_PATH = "/data/zotero-figure/comparison-layouts.json";

interface PreferencesHarness {
  io: MemoryIOHarness;
  values: Map<string, unknown>;
  restore(): void;
}

function installHarness(): PreferencesHarness {
  const previousZotero = globalThis.Zotero;
  const io = installMemoryIO();
  const values = new Map<string, unknown>();
  globalThis.Zotero = {
    DataDirectory: { dir: "/data" },
    Prefs: {
      clear: (key: string) => values.delete(key),
      get: (key: string) => values.get(key),
      set: (key: string, value: unknown) => values.set(key, value),
    },
    logError: () => undefined,
  } as unknown as typeof Zotero;
  return {
    io,
    restore: () => {
      io.restore();
      globalThis.Zotero = previousZotero;
    },
    values,
  };
}

test("persists the gallery mode in preferences and layouts in the data directory", async () => {
  const harness = installHarness();
  const layout: FigureGalleryComparisonLayout = {
    documentOrder: [2, 1],
    rows: [
      {
        entries: {
          "1": {
            entryIDs: ["first", "detail"],
            primaryEntryID: "detail",
          },
          "2": { entryIDs: ["second"], primaryEntryID: "second" },
        },
        id: "comparison-row-1",
        isGroup: true,
        label: "Main result",
      },
    ],
    version: 3,
  };

  try {
    await loadComparisonLayouts();

    assert.equal(getFigureGalleryViewMode(), "waterfall");
    setFigureGalleryViewMode("document-columns");
    assert.equal(getFigureGalleryViewMode(), "document-columns");

    setFigureGalleryComparisonLayout(7, layout);
    assert.deepEqual(getFigureGalleryComparisonLayout(7), layout);
    assert.equal(getFigureGalleryComparisonLayout(8), undefined);
    assert.equal(
      harness.values.has(
        "extensions.zotero.zoterofigure.galleryComparisonLayouts",
      ),
      false,
      "comparison layouts must not be written to a preference",
    );

    assert.equal(getFigureGalleryImageScale(), 100);
    setFigureGalleryImageScale(135);
    assert.equal(getFigureGalleryImageScale(), 135);
    setFigureGalleryImageScale(999);
    assert.equal(getFigureGalleryImageScale(), 200);
    setFigureGalleryImageScale(1);
    assert.equal(getFigureGalleryImageScale(), 50);
  } finally {
    harness.restore();
  }
});

test("migrates stored version 1 layouts through the store boundary", async () => {
  const harness = installHarness();
  harness.io.writeText(
    STORE_PATH,
    JSON.stringify({
      "7": {
        documentOrder: [2, 2, 1],
        rows: [
          {
            entries: { "1": "first", "2": "second" },
            id: "comparison-row-1",
            label: "Main result",
          },
        ],
        version: 1,
      },
    }),
  );

  try {
    await loadComparisonLayouts();
    assert.deepEqual(getFigureGalleryComparisonLayout(7), {
      documentOrder: [2, 1],
      rows: [
        {
          entries: {
            "1": { entryIDs: ["first"], primaryEntryID: "first" },
            "2": { entryIDs: ["second"], primaryEntryID: "second" },
          },
          id: "comparison-row-1",
          isGroup: true,
          label: "Main result",
        },
      ],
      version: 3,
    });
  } finally {
    harness.restore();
  }
});

test("ignores malformed persisted comparison layouts", async () => {
  const harness = installHarness();
  harness.io.writeText(STORE_PATH, "not json");
  try {
    await loadComparisonLayouts();
    assert.equal(getFigureGalleryViewMode(), "waterfall");
    assert.equal(getFigureGalleryComparisonLayout(1), undefined);
  } finally {
    harness.restore();
  }
});
