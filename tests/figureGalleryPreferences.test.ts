import * as assert from "node:assert/strict";
import test from "node:test";
import type { FigureGalleryComparisonLayout } from "../src/domain/figureGallery";
import {
  getFigureGalleryComparisonLayout,
  getFigureGalleryImageScale,
  getFigureGalleryViewMode,
  setFigureGalleryComparisonLayout,
  setFigureGalleryImageScale,
  setFigureGalleryViewMode,
} from "../src/services/results/figureGalleryPreferences";

test("persists the gallery mode and comparison layout in Zotero preferences", () => {
  const previousZotero = globalThis.Zotero;
  const values = new Map<string, unknown>();
  globalThis.Zotero = {
    Prefs: {
      clear: () => undefined,
      get: (key: string) => values.get(key),
      set: (key: string, value: unknown) => values.set(key, value),
    },
  } as unknown as typeof Zotero;
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
    assert.equal(getFigureGalleryViewMode(), "waterfall");
    setFigureGalleryViewMode("document-columns");
    assert.equal(getFigureGalleryViewMode(), "document-columns");

    setFigureGalleryComparisonLayout(7, layout);
    assert.deepEqual(getFigureGalleryComparisonLayout(7), layout);
    assert.equal(getFigureGalleryComparisonLayout(8), undefined);

    assert.equal(getFigureGalleryImageScale(), 100);
    setFigureGalleryImageScale(135);
    assert.equal(getFigureGalleryImageScale(), 135);
    setFigureGalleryImageScale(999);
    assert.equal(getFigureGalleryImageScale(), 200);
    setFigureGalleryImageScale(1);
    assert.equal(getFigureGalleryImageScale(), 50);
  } finally {
    globalThis.Zotero = previousZotero;
  }
});

test("migrates stored version 1 layouts through the preference boundary", () => {
  const previousZotero = globalThis.Zotero;
  const serialized = JSON.stringify({
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
  });
  globalThis.Zotero = {
    Prefs: {
      clear: () => undefined,
      get: (key: string) =>
        key.endsWith("galleryComparisonLayouts") ? serialized : undefined,
      set: () => undefined,
    },
  } as unknown as typeof Zotero;

  try {
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
    globalThis.Zotero = previousZotero;
  }
});

test("ignores malformed comparison layout preferences", () => {
  const previousZotero = globalThis.Zotero;
  globalThis.Zotero = {
    Prefs: {
      clear: () => undefined,
      get: (key: string) =>
        key.endsWith("galleryComparisonLayouts") ? "not json" : "unknown",
      set: () => undefined,
    },
  } as unknown as typeof Zotero;
  try {
    assert.equal(getFigureGalleryViewMode(), "waterfall");
    assert.equal(getFigureGalleryComparisonLayout(1), undefined);
  } finally {
    globalThis.Zotero = previousZotero;
  }
});
