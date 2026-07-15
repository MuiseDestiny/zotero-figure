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

test("atomically drops deleted results when a library is reloaded", async () => {
  let results: StoredFigureResult[] = [
    storedGalleryResult("old", "/images/old.png"),
  ];
  let notifyReloadStarted: (() => void) | undefined;
  let waitForReload = Promise.resolve();
  const attachment = galleryAttachment(1, "ATTACHMENT");
  const index = new FigureGalleryIndex(
    {
      list: async () => {
        notifyReloadStarted?.();
        await waitForReload;
        return results;
      },
      listIndexedAttachmentKeys: async () => ["ATTACHMENT"],
    },
    galleryPlatform([attachment]),
  );

  const first = await index.loadLibrary(1);
  const oldID = first.entries[0].id;
  assert.equal((await index.readImage(oldID)).base64, "L2ltYWdlcy9vbGQucG5n");

  results = [storedGalleryResult("new", "/images/new.png")];
  const reloadStarted = new Promise<void>((resolve) => {
    notifyReloadStarted = resolve;
  });
  let releaseReload!: () => void;
  waitForReload = new Promise<void>((resolve) => {
    releaseReload = resolve;
  });
  const pendingReload = index.loadLibrary(1);
  await reloadStarted;

  assert.equal((await index.readImage(oldID)).base64, "L2ltYWdlcy9vbGQucG5n");
  releaseReload();
  const second = await pendingReload;
  const newID = second.entries[0].id;

  await assert.rejects(index.readImage(oldID), /no longer indexed/);
  assert.equal((await index.readImage(newID)).base64, "L2ltYWdlcy9uZXcucG5n");
});

test("resolves out-of-order same-library loads to the indexed snapshot", async () => {
  const first = createDeferred<StoredFigureResult[]>();
  const second = createDeferred<StoredFigureResult[]>();
  let requestCount = 0;
  const index = new FigureGalleryIndex(
    {
      list: async () =>
        requestCount++ === 0 ? await first.promise : await second.promise,
      listIndexedAttachmentKeys: async () => ["ATTACHMENT"],
    },
    galleryPlatform([galleryAttachment(1, "ATTACHMENT")]),
  );

  const olderLoad = index.loadLibrary(1);
  const newerLoad = index.loadLibrary(1);
  second.resolve([storedGalleryResult("new", "/images/new.png")]);
  const newerSnapshot = await newerLoad;
  first.resolve([storedGalleryResult("old", "/images/old.png")]);
  const olderSnapshot = await olderLoad;

  assert.deepEqual(
    olderSnapshot.entries.map(({ id }) => id),
    newerSnapshot.entries.map(({ id }) => id),
  );
  assert.equal(
    (await index.readImage(olderSnapshot.entries[0].id)).base64,
    "L2ltYWdlcy9uZXcucG5n",
  );
});

test("bounds retained sources to the latest snapshot of each loaded library", async () => {
  const resultsByLibrary = new Map<number, StoredFigureResult[]>([
    [1, [storedGalleryResult("one-0", "/images/one-0.png")]],
    [2, [storedGalleryResult("two", "/images/two.png")]],
  ]);
  const attachments = [
    galleryAttachment(1, "ONE"),
    galleryAttachment(2, "TWO"),
  ];
  const index = new FigureGalleryIndex(
    {
      list: async (attachment) => resultsByLibrary.get(attachment.libraryID)!,
      listIndexedAttachmentKeys: async (libraryID) => [
        libraryID === 1 ? "ONE" : "TWO",
      ],
    },
    galleryPlatform(attachments),
  );

  const firstLibrary = await index.loadLibrary(1);
  const secondLibrary = await index.loadLibrary(2);
  const staleIDs = [firstLibrary.entries[0].id];

  for (let version = 1; version <= 4; version++) {
    resultsByLibrary.set(1, [
      storedGalleryResult(`one-${version}`, `/images/one-${version}.png`),
    ]);
    const snapshot = await index.loadLibrary(1);
    staleIDs.push(snapshot.entries[0].id);
  }

  for (const staleID of staleIDs.slice(0, -1)) {
    await assert.rejects(index.openSource(staleID), /no longer indexed/);
  }
  await index.openSource(staleIDs.at(-1)!);
  assert.equal(
    (await index.readImage(secondLibrary.entries[0].id)).base64,
    "L2ltYWdlcy90d28ucG5n",
  );
});

function storedGalleryResult(
  id: string,
  imagePath: string,
): StoredFigureResult {
  return {
    comment: id,
    id,
    imageFile: `images/${id}.png`,
    imagePath,
    kind: "figure",
    pageIndex: 0,
    pageLabel: "1",
    rect: [1, 2, 30, 40],
    tag: `Figure ${id}`,
  };
}

function galleryAttachment(libraryID: number, key: string): Zotero.Item {
  const documentItem = {
    getCollections: () => [],
    getDisplayTitle: () => `Document ${libraryID}`,
    getField: () => "2026",
    id: libraryID * 10,
  } as unknown as Zotero.Item;
  return {
    getDisplayTitle: () => key,
    id: libraryID * 100,
    isPDFAttachment: () => true,
    key,
    libraryID,
    topLevelItem: documentItem,
  } as unknown as Zotero.Item;
}

function galleryPlatform(
  attachments: readonly Zotero.Item[],
): FigureGalleryPlatform {
  return {
    getAttachment: async (libraryID, key) =>
      attachments.find(
        (attachment) =>
          attachment.libraryID === libraryID && attachment.key === key,
      ) ?? false,
    getCollectionName: () => undefined,
    getDefaultLibraryID: () => 1,
    listLibraries: () => [
      { id: 1, name: "One" },
      { id: 2, name: "Two" },
    ],
    logError: () => undefined,
    openPdf: async () => undefined,
    readFile: async (path) => new TextEncoder().encode(path),
  };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
