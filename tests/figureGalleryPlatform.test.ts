import * as assert from "node:assert/strict";
import test from "node:test";
import { createZoteroFigureGalleryPlatform } from "../src/platform/zotero/figureGallery";

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
