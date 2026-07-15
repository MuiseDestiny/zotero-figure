import * as assert from "node:assert/strict";
import test from "node:test";
import {
  getFigureResultFingerprint,
  getFigureResultImageFingerprint,
  getFigureResultID,
  type FigureResultAnalysisIdentity,
} from "../src/domain/figureResults";
import type { AnnotationCandidate } from "../src/domain/layout";
import {
  DEFAULT_FIGURE_RESULT_ANALYSIS_IDENTITY,
  FigureResultStore,
} from "../src/services/results/figureResultStore";
import { OperationCancelledError } from "../src/utils/cancellation";
import { installMemoryIO } from "./helpers/memoryIO";

test("figure result fingerprints and IDs are stable after normalization", () => {
  const candidate = makeCandidate({
    comment: " Figure 1. Caption ",
    rect: [1.01, 2.01, 10.01, 12.01],
    tag: " Figure 1 ",
  });
  const equivalent = makeCandidate({
    comment: "Figure 1. Caption",
    rect: [1.04, 2.04, 10.04, 12.04],
    tag: "Figure 1",
  });

  assert.equal(
    getFigureResultFingerprint(candidate),
    getFigureResultFingerprint(equivalent),
  );
  assert.equal(getFigureResultID(candidate), getFigureResultID(equivalent));
  assert.notEqual(
    getFigureResultID(candidate),
    getFigureResultID({ ...equivalent, comment: "Figure 1. Updated" }),
  );
  assert.notEqual(
    getFigureResultID(candidate),
    getFigureResultID({ ...equivalent, pageIndex: 1 }),
  );
  assert.equal(
    getFigureResultFingerprint({
      ...candidate,
      comment: "Figure 1. Manually corrected",
      detectedComment: candidate.comment,
    }),
    getFigureResultFingerprint(candidate),
  );
});

test("replace-page replaces only that page and removes obsolete images", async () => {
  const harness = installStoreHarness();
  const store = new FigureResultStore();
  const oldPageResult = makeCandidate({ comment: "Figure 1. Old" });
  const otherPageResult = makeCandidate({
    comment: "Table 2. Kept",
    pageIndex: 1,
    rect: [20, 2, 30, 12],
    tag: "Table 2",
  });
  const replacement = makeCandidate({
    comment: "Figure 1. New",
    rect: [3, 4, 13, 14],
  });

  try {
    const first = await store.reconcilePage(
      harness.item,
      0,
      [oldPageResult],
      [bytes(1)],
      "replace-page",
    );
    await store.reconcilePage(
      harness.item,
      1,
      [otherPageResult],
      [bytes(2)],
      "replace-page",
    );
    const obsoletePath = first.results[0].imagePath;

    const result = await store.reconcilePage(
      harness.item,
      0,
      [replacement],
      [bytes(9, 8)],
      "replace-page",
    );

    assert.equal(result.created, 1);
    assert.equal(result.removed, 1);
    assert.equal(result.skipped, 0);
    assert.equal(harness.io.exists(obsoletePath), false);

    const stored = await store.list(harness.item);
    assert.deepEqual(
      stored.map(({ id }) => id).sort(),
      [
        getFigureResultID(replacement),
        getFigureResultID(otherPageResult),
      ].sort(),
    );
    assert.deepEqual(
      harness.io.readBytes(
        stored.find(({ id }) => id === getFigureResultID(replacement))!
          .imagePath,
      ),
      [9, 8],
    );
    assert.deepEqual(
      harness.io.readBytes(
        stored.find(({ id }) => id === getFigureResultID(otherPageResult))!
          .imagePath,
      ),
      [2],
    );
  } finally {
    harness.restore();
  }
});

test("replace-page reuses a versioned PNG when the fingerprint is unchanged", async () => {
  const harness = installStoreHarness();
  const store = new FigureResultStore();
  const candidate = makeCandidate();

  try {
    const seeded = await store.reconcilePage(
      harness.item,
      0,
      [candidate],
      [bytes(1)],
      "replace-page",
    );
    const imagePath = seeded.results[0].imagePath;
    const manifest = JSON.parse(harness.io.readText(getManifestPath())!) as {
      analysisIdentity: FigureResultAnalysisIdentity;
      imageCache: Record<
        string,
        FigureResultAnalysisIdentity & {
          fingerprint: string;
          sourceFingerprint: string;
        }
      >;
    };
    assert.deepEqual(
      manifest.analysisIdentity,
      DEFAULT_FIGURE_RESULT_ANALYSIS_IDENTITY,
    );
    assert.deepEqual(manifest.imageCache[seeded.results[0].id], {
      ...DEFAULT_FIGURE_RESULT_ANALYSIS_IDENTITY,
      fingerprint: getFigureResultImageFingerprint(candidate),
      sourceFingerprint: "item:4:ATTACHMENT:1",
    });
    harness.io.operations.directories.length = 0;
    harness.io.operations.textWrites.length = 0;
    harness.io.operations.writes.length = 0;

    const repeated = await store.reconcilePage(
      harness.item,
      0,
      [candidate],
      [bytes(9, 8, 7)],
      "replace-page",
    );

    assert.equal(repeated.created, 0);
    assert.equal(repeated.removed, 0);
    assert.equal(repeated.skipped, 1);
    assert.equal(repeated.results[0].id, seeded.results[0].id);
    assert.deepEqual(harness.io.readBytes(imagePath), [1]);
    assert.deepEqual(harness.io.operations.writes, []);
    assert.deepEqual(harness.io.operations.directories, []);
    assert.deepEqual(harness.io.operations.textWrites, []);
    assert.equal(repeated.timings.imageWriteMs, 0);
    assert.equal(repeated.timings.manifestWriteMs, 0);
    assert.ok(repeated.timings.lockWaitMs >= 0);
  } finally {
    harness.restore();
  }
});

test("exposes an exact page cache hit only while every versioned image exists", async () => {
  const harness = installStoreHarness();
  const store = new FigureResultStore();
  const candidate = makeCandidate();

  try {
    const seeded = await store.reconcilePage(
      harness.item,
      0,
      [candidate],
      [bytes(1, 2)],
      "replace-page",
    );

    const cached = await store.getReusablePageResults(harness.item, 0, [
      candidate,
    ]);
    assert.deepEqual(
      cached?.map(({ id }) => id),
      [seeded.results[0].id],
    );
    assert.equal(
      await store.getReusablePageResults(harness.item, 0, [
        makeCandidate({ comment: "Figure 1. Changed" }),
      ]),
      undefined,
    );

    harness.io.delete(seeded.results[0].imagePath);
    assert.equal(
      await store.getReusablePageResults(harness.item, 0, [candidate]),
      undefined,
    );
    await store.reconcilePage(
      harness.item,
      0,
      [candidate],
      [bytes(6)],
      "replace-page",
    );
    assert.deepEqual(harness.io.readBytes(seeded.results[0].imagePath), [6]);
  } finally {
    harness.restore();
  }
});

test("rewrites a matching image when its analysis identity changes", async () => {
  const harness = installStoreHarness();
  const candidate = makeCandidate();
  const originalStore = new FigureResultStore();
  const changedIdentity: FigureResultAnalysisIdentity = {
    ...DEFAULT_FIGURE_RESULT_ANALYSIS_IDENTITY,
    previewVersion: "pdf-page-crops-v3-test",
  };
  const upgradedStore = new FigureResultStore({
    analysisIdentity: changedIdentity,
  });

  try {
    const seeded = await originalStore.reconcilePage(
      harness.item,
      0,
      [candidate],
      [bytes(1)],
      "replace-page",
    );
    const imagePath = seeded.results[0].imagePath;
    harness.io.operations.writes.length = 0;

    await upgradedStore.reconcilePage(
      harness.item,
      0,
      [candidate],
      [bytes(9)],
      "replace-page",
    );
    assert.deepEqual(harness.io.readBytes(imagePath), [9]);
    assert.equal(harness.io.operations.writes.length, 1);

    harness.io.operations.writes.length = 0;
    await upgradedStore.reconcilePage(
      harness.item,
      0,
      [candidate],
      [bytes(7)],
      "replace-page",
    );
    assert.deepEqual(harness.io.readBytes(imagePath), [9]);
    assert.equal(harness.io.operations.writes.length, 0);
  } finally {
    harness.restore();
  }
});

test("invalidates cached previews when the attachment source changes", async () => {
  const harness = installStoreHarness();
  const store = new FigureResultStore();
  const candidate = makeCandidate();

  try {
    const seeded = await store.reconcilePage(
      harness.item,
      0,
      [candidate],
      [bytes(1)],
      "replace-page",
    );
    const imagePath = seeded.results[0].imagePath;
    (harness.item as Zotero.Item & { version: number }).version = 2;

    assert.equal(
      await store.getReusablePageResults(harness.item, 0, [candidate]),
      undefined,
    );
    harness.io.operations.writes.length = 0;
    await store.reconcilePage(
      harness.item,
      0,
      [candidate],
      [bytes(9)],
      "replace-page",
    );
    assert.deepEqual(harness.io.readBytes(imagePath), [9]);
    assert.equal(harness.io.operations.writes.length, 1);
  } finally {
    harness.restore();
  }
});

test("clear removes the attachment's local manifest and images", async () => {
  const harness = installStoreHarness();
  const store = new FigureResultStore();
  const candidate = makeCandidate();

  try {
    const seeded = await store.reconcilePage(
      harness.item,
      0,
      [candidate],
      [bytes(1, 2, 3)],
      "replace-page",
    );
    const imagePath = seeded.results[0].imagePath;

    const removed = await store.clear(harness.item);

    assert.deepEqual(
      removed.map(({ id }) => id),
      [seeded.results[0].id],
    );
    assert.equal(harness.io.exists(getManifestPath()), false);
    assert.equal(harness.io.exists(imagePath), false);
    assert.deepEqual(await store.list(harness.item), []);
  } finally {
    harness.restore();
  }
});

test("skip-existing reuses cached images and writes only missing results", async () => {
  const harness = installStoreHarness();
  const store = new FigureResultStore();
  const existing = makeCandidate({ comment: "Figure 1. Existing" });
  const missing = makeCandidate({
    comment: "Table 1. Missing",
    rect: [20, 2, 30, 12],
    tag: "Table 1",
  });

  try {
    const seeded = await store.reconcilePage(
      harness.item,
      0,
      [existing],
      [bytes(1)],
      "replace-page",
    );
    const existingPath = seeded.results[0].imagePath;
    harness.io.operations.directories.length = 0;
    harness.io.operations.writes.length = 0;

    const result = await store.reconcilePage(
      harness.item,
      0,
      [existing, missing],
      [bytes(7), bytes(8)],
      "skip-existing",
    );

    assert.equal(result.created, 1);
    assert.equal(result.removed, 0);
    assert.equal(result.skipped, 1);
    assert.equal(result.results.length, 2);
    assert.deepEqual(harness.io.readBytes(existingPath), [1]);
    assert.deepEqual(
      harness.io.readBytes(
        result.results.find(({ id }) => id === getFigureResultID(missing))!
          .imagePath,
      ),
      [8],
    );
    assert.equal(harness.io.operations.directories.length, 1);
    assert.equal(harness.io.operations.writes.length, 1);
    assert.equal(harness.io.operations.writes[0].flush, undefined);
  } finally {
    harness.restore();
  }
});

test("persists translations in the local manifest by target-language context", async () => {
  const harness = installStoreHarness();
  const store = new FigureResultStore();
  const candidate = makeCandidate();
  const contextKey = "zotero-pdf-translate/v1:zh-Hans";

  try {
    const seeded = await store.reconcilePage(
      harness.item,
      0,
      [candidate],
      [bytes(1)],
      "replace-page",
    );
    await store.saveTranslations(harness.item, contextKey, [
      {
        id: seeded.results[0].id,
        source: candidate.comment,
        text: "图 1。说明",
      },
    ]);

    assert.deepEqual(
      [...(await store.getCachedTranslations(harness.item, contextKey))],
      [[seeded.results[0].id, "图 1。说明"]],
    );
    assert.equal(
      (
        await store.getCachedTranslations(
          harness.item,
          "zotero-pdf-translate/v1:ru",
        )
      ).size,
      0,
    );
    const manifest = JSON.parse(
      harness.io.readText(getManifestPath())!,
    ) as Record<string, unknown>;
    assert.equal(manifest.schemaVersion, 5);
    assert.ok(manifest.analysisIdentity);
    assert.ok(manifest.imageCache);
    assert.ok(manifest.translations);
  } finally {
    harness.restore();
  }
});

test("preserves manual captions across repeated analysis without rewriting PNGs", async () => {
  const harness = installStoreHarness();
  const store = new FigureResultStore();
  const candidate = makeCandidate({ comment: "Figure 1. Detected caption" });
  const contextKey = "zotero-pdf-translate/v1:zh-Hans";

  try {
    const seeded = await store.reconcilePage(
      harness.item,
      0,
      [candidate],
      [bytes(1, 2, 3)],
      "replace-page",
    );
    const original = seeded.results[0];
    await store.saveTranslations(harness.item, contextKey, [
      { id: original.id, source: original.comment, text: "旧翻译" },
    ]);

    const updated = await store.updateComment(
      harness.item,
      original.id,
      "  Figure 1. Corrected caption  ",
    );

    assert.equal(updated?.id, original.id);
    assert.equal(updated?.comment, "Figure 1. Corrected caption");
    assert.equal(updated?.detectedComment, candidate.comment);
    assert.deepEqual(harness.io.readBytes(original.imagePath), [1, 2, 3]);
    assert.equal(
      (await store.getCachedTranslations(harness.item, contextKey)).size,
      0,
    );
    assert.equal(
      (await store.getReusablePageResults(harness.item, 0, [candidate]))?.[0]
        .comment,
      "Figure 1. Corrected caption",
    );

    harness.io.operations.writes.length = 0;
    const repeated = await store.reconcilePage(
      harness.item,
      0,
      [candidate],
      [bytes(9)],
      "replace-page",
    );
    assert.equal(repeated.skipped, 1);
    assert.equal(repeated.results[0].comment, "Figure 1. Corrected caption");
    assert.deepEqual(harness.io.readBytes(original.imagePath), [1, 2, 3]);
    assert.deepEqual(harness.io.operations.writes, []);

    const reset = await store.updateComment(
      harness.item,
      original.id,
      candidate.comment,
    );
    assert.equal(reset?.comment, candidate.comment);
    assert.equal(reset?.detectedComment, undefined);
    const manifest = JSON.parse(harness.io.readText(getManifestPath())!) as {
      schemaVersion: number;
    };
    assert.equal(manifest.schemaVersion, 5);
  } finally {
    harness.restore();
  }
});

test("persists manual crop corrections across repeated analysis", async () => {
  const harness = installStoreHarness();
  const store = new FigureResultStore();
  const candidate = makeCandidate();
  const correctedRect: [number, number, number, number] = [2, 3, 12, 14];

  try {
    const seeded = await store.reconcilePage(
      harness.item,
      0,
      [candidate],
      [bytes(1)],
      "replace-page",
    );
    const original = seeded.results[0];
    const corrected = await store.updateRegion(
      harness.item,
      original.id,
      correctedRect,
      bytes(9, 8),
    );

    assert.equal(corrected?.id, original.id);
    assert.deepEqual(corrected?.rect, correctedRect);
    assert.deepEqual(corrected?.detectedRect, candidate.rect);
    assert.deepEqual(harness.io.readBytes(original.imagePath), [9, 8]);

    const repeated = await store.reconcilePage(
      harness.item,
      0,
      [candidate],
      [bytes(2)],
      "replace-page",
    );
    assert.deepEqual(repeated.results[0].rect, correctedRect);
    assert.deepEqual(repeated.results[0].detectedRect, candidate.rect);
    assert.deepEqual(harness.io.readBytes(original.imagePath), [9, 8]);

    const reset = await store.updateRegion(
      harness.item,
      original.id,
      candidate.rect,
      bytes(7),
    );
    assert.deepEqual(reset?.rect, candidate.rect);
    assert.equal(reset?.detectedRect, undefined);
    assert.deepEqual(harness.io.readBytes(original.imagePath), [7]);
  } finally {
    harness.restore();
  }
});

test("migrates schema v1 without losing results or images", async () => {
  const harness = installStoreHarness();
  const store = new FigureResultStore();
  const candidate = makeCandidate();

  try {
    const seeded = await store.reconcilePage(
      harness.item,
      0,
      [candidate],
      [bytes(4, 2)],
      "replace-page",
    );
    const imagePath = seeded.results[0].imagePath;
    const legacy = JSON.parse(harness.io.readText(getManifestPath())!) as {
      schemaVersion: number;
      translations?: unknown;
    };
    legacy.schemaVersion = 1;
    delete legacy.translations;
    harness.io.writeText(getManifestPath(), JSON.stringify(legacy));

    const restored = await new FigureResultStore().list(harness.item);
    assert.equal(restored.length, 1);
    assert.equal(restored[0].id, seeded.results[0].id);
    assert.deepEqual(harness.io.readBytes(imagePath), [4, 2]);

    await store.saveTranslations(harness.item, "zotero-pdf-translate/v1:it", [
      { id: restored[0].id, source: candidate.comment, text: "Figura 1" },
    ]);
    const upgraded = JSON.parse(harness.io.readText(getManifestPath())!) as {
      schemaVersion: number;
    };
    assert.equal(upgraded.schemaVersion, 5);

    harness.io.operations.writes.length = 0;
    await store.reconcilePage(
      harness.item,
      0,
      [candidate],
      [bytes(6)],
      "replace-page",
    );
    assert.deepEqual(harness.io.readBytes(imagePath), [6]);
    assert.equal(harness.io.operations.writes.length, 1);
  } finally {
    harness.restore();
  }
});

test("migrates schema v2 translations and rebuilds missing image metadata", async () => {
  const harness = installStoreHarness();
  const store = new FigureResultStore();
  const candidate = makeCandidate();
  const contextKey = "zotero-pdf-translate/v1:it";

  try {
    const seeded = await store.reconcilePage(
      harness.item,
      0,
      [candidate],
      [bytes(2)],
      "replace-page",
    );
    await store.saveTranslations(harness.item, contextKey, [
      { id: seeded.results[0].id, source: candidate.comment, text: "Figura 1" },
    ]);
    const schema2 = JSON.parse(harness.io.readText(getManifestPath())!) as {
      analysisIdentity?: unknown;
      imageCache?: unknown;
      schemaVersion: number;
    };
    schema2.schemaVersion = 2;
    delete schema2.analysisIdentity;
    delete schema2.imageCache;
    harness.io.writeText(getManifestPath(), JSON.stringify(schema2));
    harness.io.operations.writes.length = 0;

    assert.equal(
      (await store.getCachedTranslations(harness.item, contextKey)).get(
        seeded.results[0].id,
      ),
      "Figura 1",
    );
    await store.reconcilePage(
      harness.item,
      0,
      [candidate],
      [bytes(8)],
      "replace-page",
    );

    assert.deepEqual(harness.io.readBytes(seeded.results[0].imagePath), [8]);
    assert.equal(harness.io.operations.writes.length, 1);
    const upgraded = JSON.parse(harness.io.readText(getManifestPath())!) as {
      imageCache?: unknown;
      schemaVersion: number;
    };
    assert.equal(upgraded.schemaVersion, 5);
    assert.ok(upgraded.imageCache);
    assert.equal(
      (await store.getCachedTranslations(harness.item, contextKey)).get(
        seeded.results[0].id,
      ),
      "Figura 1",
    );
  } finally {
    harness.restore();
  }
});

test("cancels a queued attachment lock without blocking the next waiter", async () => {
  const harness = installStoreHarness();
  const store = new FigureResultStore();
  const candidate = makeCandidate();

  try {
    await store.reconcilePage(
      harness.item,
      0,
      [candidate],
      [bytes(1)],
      "replace-page",
    );
    const entered = deferred<void>();
    const resume = deferred<void>();
    const originalReadUTF8 = IOUtils.readUTF8.bind(IOUtils);
    let blockFirstRead = true;
    IOUtils.readUTF8 = async (path: string) => {
      if (blockFirstRead) {
        blockFirstRead = false;
        entered.resolve();
        await resume.promise;
      }
      return originalReadUTF8(path);
    };

    const holder = store.list(harness.item);
    await entered.promise;
    const controller = new AbortController();
    const cancelled = store.reconcilePage(
      harness.item,
      0,
      [candidate],
      [bytes(2)],
      "replace-page",
      controller.signal,
    );
    const next = store.reconcilePage(
      harness.item,
      0,
      [candidate],
      [bytes(3)],
      "replace-page",
    );

    controller.abort();
    await assert.rejects(cancelled, OperationCancelledError);
    resume.resolve();
    await holder;
    const nextResult = await next;
    assert.equal(nextResult.skipped, 1);
  } finally {
    harness.restore();
  }
});

test("removes temporary image data when an atomic move fails", async () => {
  const harness = installStoreHarness();
  const store = new FigureResultStore();
  const originalMove = IOUtils.move.bind(IOUtils);
  IOUtils.move = async (source: string, destination: string, options) => {
    if (destination.endsWith(".png")) throw new Error("simulated move failure");
    return originalMove(source, destination, options);
  };

  try {
    await assert.rejects(
      store.reconcilePage(
        harness.item,
        0,
        [makeCandidate()],
        [bytes(1, 2)],
        "replace-page",
      ),
      /simulated move failure/,
    );
    assert.deepEqual(await store.list(harness.item), []);
    for (const { path } of harness.io.operations.writes) {
      assert.equal(harness.io.exists(path), false);
    }
  } finally {
    harness.restore();
  }
});

test("preserves translations for unchanged results and prunes replaced results", async () => {
  const harness = installStoreHarness();
  const store = new FigureResultStore();
  const original = makeCandidate();
  const added = makeCandidate({
    comment: "Table 1. Caption",
    rect: [20, 2, 30, 12],
    tag: "Table 1",
  });
  const replacement = makeCandidate({
    comment: "Figure 2. Replacement",
    rect: [40, 2, 50, 12],
    tag: "Figure 2",
  });
  const contextKey = "zotero-pdf-translate/v1:zh-Hans";

  try {
    const seeded = await store.reconcilePage(
      harness.item,
      0,
      [original],
      [bytes(1)],
      "replace-page",
    );
    await store.saveTranslations(harness.item, contextKey, [
      {
        id: seeded.results[0].id,
        source: original.comment,
        text: "图 1",
      },
    ]);

    await store.reconcilePage(
      harness.item,
      0,
      [original, added],
      [bytes(1), bytes(2)],
      "replace-page",
    );
    assert.equal(
      (await store.getCachedTranslations(harness.item, contextKey)).get(
        seeded.results[0].id,
      ),
      "图 1",
    );

    await store.reconcilePage(
      harness.item,
      0,
      [replacement],
      [bytes(3)],
      "replace-page",
    );
    assert.equal(
      (await store.getCachedTranslations(harness.item, contextKey)).size,
      0,
    );
    assert.equal(
      JSON.stringify(
        (
          JSON.parse(harness.io.readText(getManifestPath())!) as {
            translations: unknown;
          }
        ).translations,
      ).includes(seeded.results[0].id),
      false,
    );
  } finally {
    harness.restore();
  }
});

test("discovers only attachment result directories with manifests", async () => {
  const harness = installStoreHarness();
  const store = new FigureResultStore();
  try {
    harness.io.writeText(
      "/data/zotero-figure/results/4/B_ATTACHMENT/manifest.json",
      "{}",
    );
    harness.io.writeText(
      "/data/zotero-figure/results/4/A_ATTACHMENT/manifest.json",
      "{}",
    );
    harness.io.writeText(
      "/data/zotero-figure/results/4/NO_MANIFEST/images/result.png",
      "not-an-image",
    );
    harness.io.writeText(
      "/data/zotero-figure/results/4/invalid.key/manifest.json",
      "{}",
    );

    assert.deepEqual(await store.listIndexedAttachmentKeys(4), [
      "A_ATTACHMENT",
      "B_ATTACHMENT",
    ]);
    assert.deepEqual(await store.listIndexedAttachmentKeys(5), []);
    await assert.rejects(store.listIndexedAttachmentKeys(-1), /invalid ID/);
  } finally {
    harness.restore();
  }
});

function installStoreHarness(): {
  io: ReturnType<typeof installMemoryIO>;
  item: Zotero.Item;
  restore(): void;
} {
  const previousZotero = globalThis.Zotero;
  const io = installMemoryIO();
  globalThis.Zotero = {
    DataDirectory: { dir: "/data" },
  } as unknown as typeof Zotero;
  return {
    io,
    item: { key: "ATTACHMENT", libraryID: 4, version: 1 } as Zotero.Item,
    restore: () => {
      io.restore();
      globalThis.Zotero = previousZotero;
    },
  };
}

function makeCandidate(
  overrides: Partial<AnnotationCandidate> = {},
): AnnotationCandidate {
  return {
    comment: "Figure 1. Caption",
    pageIndex: 0,
    rect: [1, 2, 10, 12],
    tag: "Figure 1",
    ...overrides,
  };
}

function bytes(...values: number[]): ArrayBuffer {
  return Uint8Array.from(values).buffer as ArrayBuffer;
}

function getManifestPath(): string {
  return "/data/zotero-figure/results/4/ATTACHMENT/manifest.json";
}

function deferred<Value>(): {
  promise: Promise<Value>;
  resolve(value: Value): void;
} {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
