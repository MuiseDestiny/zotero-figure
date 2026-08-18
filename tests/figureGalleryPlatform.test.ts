import * as assert from "node:assert/strict";
import test from "node:test";
import { createZoteroFigureGalleryPlatform } from "../src/platform/zotero/figureGallery";

test("uses Zotero's multi-library selection API for the gallery default", () => {
  const previousZotero = globalThis.Zotero;
  let legacyCallCount = 0;
  globalThis.Zotero = {
    Libraries: { userLibraryID: 1 },
    getActiveZoteroPane: () => ({
      getSelectedLibraryID: () => {
        legacyCallCount += 1;
        return 3;
      },
      getSelectedLibraryIDs: () => [7, 8],
    }),
  } as unknown as typeof Zotero;

  try {
    assert.equal(createZoteroFigureGalleryPlatform().getDefaultLibraryID(), 7);
    assert.equal(legacyCallCount, 0);
  } finally {
    globalThis.Zotero = previousZotero;
  }
});

test("supports Zotero versions with only the legacy library selection API", () => {
  const previousZotero = globalThis.Zotero;
  globalThis.Zotero = {
    Libraries: { userLibraryID: 1 },
    getActiveZoteroPane: () => ({ getSelectedLibraryID: () => 4 }),
  } as unknown as typeof Zotero;

  try {
    assert.equal(createZoteroFigureGalleryPlatform().getDefaultLibraryID(), 4);
  } finally {
    globalThis.Zotero = previousZotero;
  }
});

test("uses the user library when Zotero has no selected library", () => {
  const previousZotero = globalThis.Zotero;
  globalThis.Zotero = {
    Libraries: { userLibraryID: 1 },
    getActiveZoteroPane: () => ({ getSelectedLibraryIDs: () => [] }),
  } as unknown as typeof Zotero;

  try {
    assert.equal(createZoteroFigureGalleryPlatform().getDefaultLibraryID(), 1);
  } finally {
    globalThis.Zotero = previousZotero;
  }
});

test("skips invalid IDs returned by Zotero's multi-library API", () => {
  const previousZotero = globalThis.Zotero;
  globalThis.Zotero = {
    Libraries: { userLibraryID: 1 },
    getActiveZoteroPane: () => ({
      getSelectedLibraryIDs: () => [Number.NaN, 9],
    }),
  } as unknown as typeof Zotero;

  try {
    assert.equal(createZoteroFigureGalleryPlatform().getDefaultLibraryID(), 9);
  } finally {
    globalThis.Zotero = previousZotero;
  }
});

test("opens a gallery result through Zotero's location-aware Reader API", async () => {
  const previousZotero = globalThis.Zotero;
  const calls: unknown[][] = [];
  globalThis.Zotero = {
    Reader: {
      open: async (...args: unknown[]) => {
        calls.push(args);
      },
    },
  } as unknown as typeof Zotero;

  try {
    await createZoteroFigureGalleryPlatform().openPdf(42, 3, [10, 20, 110, 70]);
  } finally {
    globalThis.Zotero = previousZotero;
  }

  assert.deepEqual(calls, [
    [
      42,
      { position: { pageIndex: 3, rects: [[10, 20, 110, 70]] } },
      { openInBackground: false },
    ],
  ]);
});
