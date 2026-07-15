import * as assert from "node:assert/strict";
import test from "node:test";
import type { FigureGalleryPlatform } from "../src/platform/zotero/figureGallery";
import { FigureGalleryIndex } from "../src/services/results/figureGalleryIndex";
import type { StoredFigureResult } from "../src/services/results/figureResultStore";

test("builds a library snapshot without exposing local image paths", async () => {
  const opened: unknown[][] = [];
  const errors: Error[] = [];
  const documentItem = {
    getCollections: () => [7, 8],
    getDisplayTitle: () => "A paper",
    getField: () => "Issued 2024-03",
    id: 12,
  } as unknown as Zotero.Item;
  const attachment = {
    getDisplayTitle: () => "Attachment",
    id: 21,
    isPDFAttachment: () => true,
    key: "ATTACHMENT",
    topLevelItem: documentItem,
  } as unknown as Zotero.Item;
  const storedResult: StoredFigureResult = {
    comment: "Figure 1. Results",
    id: "1-result",
    imageFile: "images/1-result.png",
    imagePath: "/private/result.png",
    kind: "figure",
    pageIndex: 2,
    pageLabel: "iii",
    rect: [1, 2, 30, 40],
    tag: "Figure 1",
  };
  const resultStore = {
    list: async () => [storedResult],
    listIndexedAttachmentKeys: async () => ["ATTACHMENT", "MISSING"],
  };
  const platform: FigureGalleryPlatform = {
    getAttachment: async (_libraryID, key) =>
      key === "ATTACHMENT" ? attachment : false,
    getCollectionName: (id) => (id === 7 ? "Methods" : undefined),
    getDefaultLibraryID: () => 4,
    listLibraries: () => [
      { id: 9, name: "Group" },
      { id: 4, name: "My Library" },
    ],
    logError: (error) => errors.push(error),
    openPdf: async (...args) => {
      opened.push(args);
    },
    readFile: async () => Uint8Array.from([1, 2, 3]),
  };
  const index = new FigureGalleryIndex(resultStore, platform);

  const bootstrap = index.getBootstrap();
  const snapshot = await index.loadLibrary(4);

  assert.equal(bootstrap.defaultLibraryID, 4);
  assert.deepEqual(
    bootstrap.libraries.map(({ name }) => name),
    ["Group", "My Library"],
  );
  assert.equal(snapshot.libraryID, 4);
  assert.equal(snapshot.entries.length, 1);
  assert.deepEqual(snapshot.entries[0], {
    attachmentID: 21,
    collectionIDs: [7],
    collectionNames: ["Methods"],
    comment: "Figure 1. Results",
    documentItemID: 12,
    documentTitle: "A paper",
    id: "4:ATTACHMENT:1-result",
    kind: "figure",
    libraryID: 4,
    pageIndex: 2,
    pageLabel: "iii",
    rect: [1, 2, 30, 40],
    tag: "Figure 1",
    year: "2024",
  });
  assert.equal("imagePath" in snapshot.entries[0], false);
  assert.deepEqual(await index.readImage(snapshot.entries[0].id), {
    base64: "AQID",
    mimeType: "image/png",
  });
  await index.openSource(snapshot.entries[0].id);
  assert.deepEqual(opened, [[21, 2, [1, 2, 30, 40]]]);
  assert.deepEqual(errors, []);
});

test("rejects unavailable libraries and stale result IDs", async () => {
  const index = new FigureGalleryIndex(
    {
      list: async () => [],
      listIndexedAttachmentKeys: async () => [],
    },
    {
      getAttachment: async () => false,
      getCollectionName: () => undefined,
      getDefaultLibraryID: () => 1,
      listLibraries: () => [{ id: 1, name: "Library" }],
      logError: () => undefined,
      openPdf: async () => undefined,
      readFile: async () => new Uint8Array(),
    },
  );

  await assert.rejects(index.loadLibrary(2), /library 2 is unavailable/);
  await assert.rejects(index.readImage("missing"), /no longer indexed/);
  await assert.rejects(index.openSource("missing"), /no longer indexed/);
});
