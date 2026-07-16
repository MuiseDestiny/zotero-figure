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

test("plans corrected render rectangles without changing detected candidates", async () => {
  const harness = installStoreHarness();
  const store = new FigureResultStore();
  const first = makeCandidate({ comment: "Figure 1. First" });
  const second = makeCandidate({
    comment: "Table 2. Second",
    rect: [20, 2, 30, 12],
    tag: "Table 2",
  });
  const correctedRect: [number, number, number, number] = [2, 3, 12, 14];

  try {
    const seeded = await store.reconcilePage(
      harness.item,
      0,
      [first, second],
      [bytes(1), bytes(2)],
      "replace-page",
    );
    await store.updateRegion(
      harness.item,
      seeded.results.find(({ id }) => id === getFigureResultID(first))!.id,
      correctedRect,
      bytes(9),
    );

    const detected = [second, first];
    const planned = await store.getPageRenderCandidates(
      harness.item,
      0,
      detected,
    );

    assert.deepEqual(
      planned.map(({ detectedCandidate }) => detectedCandidate),
      detected,
    );
    assert.deepEqual(
      planned.map(({ renderRect }) => renderRect),
      [second.rect, correctedRect],
    );
    assert.deepEqual(first.rect, [1, 2, 10, 12]);
  } finally {
    harness.restore();
  }
});

test("does not overwrite a newer manual crop with a stale render plan", async () => {
  const harness = installStoreHarness();
  const store = new FigureResultStore();
  const candidate = makeCandidate();
  const firstRect: [number, number, number, number] = [2, 3, 12, 14];
  const latestRect: [number, number, number, number] = [3, 4, 13, 15];

  try {
    const seeded = await store.reconcilePage(
      harness.item,
      0,
      [candidate],
      [bytes(1)],
      "replace-page",
    );
    await store.updateRegion(
      harness.item,
      seeded.results[0].id,
      firstRect,
      bytes(2),
    );
    const stalePlan = await store.getPageRenderCandidates(harness.item, 0, [
      candidate,
    ]);
    await store.updateRegion(
      harness.item,
      seeded.results[0].id,
      latestRect,
      bytes(3),
    );
    (harness.item as Zotero.Item & { version: number }).version = 2;

    await store.reconcilePlannedPage(
      harness.item,
      0,
      stalePlan,
      [bytes(9)],
      "replace-page",
    );

    const [preserved] = await store.list(harness.item);
    assert.deepEqual(preserved.rect, latestRect);
    assert.deepEqual(harness.io.readBytes(preserved.imagePath), [3]);
    assert.equal(
      await store.getReusablePageResults(harness.item, 0, [candidate]),
      undefined,
    );

    const currentPlan = await store.getPageRenderCandidates(harness.item, 0, [
      candidate,
    ]);
    await store.reconcilePlannedPage(
      harness.item,
      0,
      currentPlan,
      [bytes(8)],
      "replace-page",
    );
    const [refreshed] = await store.list(harness.item);
    assert.deepEqual(refreshed.rect, latestRect);
    assert.deepEqual(harness.io.readBytes(refreshed.imagePath), [8]);
    assert.ok(await store.getReusablePageResults(harness.item, 0, [candidate]));
  } finally {
    harness.restore();
  }
});

test("does not apply detected-rect images to a persisted manual crop", async () => {
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
    await store.updateRegion(
      harness.item,
      seeded.results[0].id,
      correctedRect,
      bytes(3),
    );
    (harness.item as Zotero.Item & { version: number }).version = 2;

    await store.reconcilePage(
      harness.item,
      0,
      [candidate],
      [bytes(9)],
      "replace-page",
    );

    const [preserved] = await store.list(harness.item);
    assert.deepEqual(preserved.rect, correctedRect);
    assert.deepEqual(harness.io.readBytes(preserved.imagePath), [3]);
    assert.equal(
      await store.getReusablePageResults(harness.item, 0, [candidate]),
      undefined,
    );
  } finally {
    harness.restore();
  }
});

test("refreshes an invalid cache when equivalent detection coordinates jitter", async () => {
  const harness = installStoreHarness();
  const store = new FigureResultStore();
  const original = makeCandidate({ rect: [1.01, 2.01, 10.01, 12.01] });
  const jittered = makeCandidate({ rect: [1.04, 2.04, 10.04, 12.04] });

  try {
    const seeded = await store.reconcilePage(
      harness.item,
      0,
      [original],
      [bytes(1)],
      "replace-page",
    );
    (harness.item as Zotero.Item & { version: number }).version = 2;
    const plan = await store.getPageRenderCandidates(harness.item, 0, [
      jittered,
    ]);
    assert.deepEqual(plan[0].renderRect, jittered.rect);

    await store.reconcilePlannedPage(
      harness.item,
      0,
      plan,
      [bytes(9)],
      "replace-page",
    );

    const [stored] = await store.list(harness.item);
    assert.equal(stored.id, seeded.results[0].id);
    assert.deepEqual(stored.rect, jittered.rect);
    assert.deepEqual(harness.io.readBytes(stored.imagePath), [9]);
    assert.ok(await store.getReusablePageResults(harness.item, 0, [jittered]));
  } finally {
    harness.restore();
  }
});

test("does not replace corrupt or unreadable manifests with empty data", async () => {
  const harness = installStoreHarness();
  const store = new FigureResultStore();
  const candidate = makeCandidate();

  try {
    assert.deepEqual(await store.list(harness.item), []);
    const seeded = await store.reconcilePage(
      harness.item,
      0,
      [candidate],
      [bytes(1, 2, 3)],
      "replace-page",
    );
    const imagePath = seeded.results[0].imagePath;
    const corruptManifest = "{ definitely-not-json";
    harness.io.writeText(getManifestPath(), corruptManifest);

    await assert.rejects(store.list(harness.item), /contains invalid JSON/);
    await assert.rejects(
      store.reconcilePage(
        harness.item,
        0,
        [candidate],
        [bytes(9)],
        "replace-page",
      ),
      /contains invalid JSON/,
    );
    assert.equal(harness.io.readText(getManifestPath()), corruptManifest);
    assert.deepEqual(harness.io.readBytes(imagePath), [1, 2, 3]);

    const originalReadUTF8 = IOUtils.readUTF8.bind(IOUtils);
    IOUtils.readUTF8 = async () => {
      throw new Error("simulated read failure");
    };
    await assert.rejects(
      store.list(harness.item),
      /could not be read: simulated read failure/,
    );
    IOUtils.readUTF8 = originalReadUTF8;
    assert.equal(harness.io.readText(getManifestPath()), corruptManifest);
  } finally {
    harness.restore();
  }
});

for (const scenario of [
  { mode: "skip-existing", name: "skip-existing", withNewResult: true },
  { mode: "replace-page", name: "matching replace-page", withNewResult: false },
  { mode: "replace-page", name: "changed replace-page", withNewResult: true },
] as const) {
  test(`restores PNGs when ${scenario.name} manifest commit fails`, async () => {
    const harness = installStoreHarness();
    const store = new FigureResultStore();
    const existing = makeCandidate();
    const added = makeCandidate({
      comment: "Table 2. Added",
      rect: [20, 2, 30, 12],
      tag: "Table 2",
    });

    try {
      const seeded = await store.reconcilePage(
        harness.item,
        0,
        [existing],
        [bytes(1, 2, 3)],
        "replace-page",
      );
      const originalManifest = harness.io.readText(getManifestPath());
      const candidates = scenario.withNewResult
        ? [existing, added]
        : [existing];
      const images = scenario.withNewResult ? [bytes(9), bytes(8)] : [bytes(9)];
      (harness.item as Zotero.Item & { version: number }).version = 2;
      const originalMove = IOUtils.move.bind(IOUtils);
      IOUtils.move = async (source: string, destination: string, options) => {
        if (destination === getManifestPath()) {
          throw new Error("simulated manifest commit failure");
        }
        return originalMove(source, destination, options);
      };

      await assert.rejects(
        store.reconcilePage(harness.item, 0, candidates, images, scenario.mode),
        /simulated manifest commit failure/,
      );

      assert.equal(harness.io.readText(getManifestPath()), originalManifest);
      assert.deepEqual(
        harness.io.readBytes(seeded.results[0].imagePath),
        [1, 2, 3],
      );
      assert.equal(
        harness.io.exists(
          `/data/zotero-figure/results/4/ATTACHMENT/images/${getFigureResultID(
            added,
          )}.png`,
        ),
        false,
      );
    } finally {
      harness.restore();
    }
  });
}

test("restores an overwritten PNG when reconciliation is cancelled", async () => {
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
    const originalManifest = harness.io.readText(getManifestPath());
    (harness.item as Zotero.Item & { version: number }).version = 2;
    const controller = new AbortController();
    const originalMove = IOUtils.move.bind(IOUtils);
    let cancelled = false;
    IOUtils.move = async (source: string, destination: string, options) => {
      const result = await originalMove(source, destination, options);
      if (!cancelled && destination.endsWith(".png")) {
        cancelled = true;
        controller.abort();
      }
      return result;
    };

    await assert.rejects(
      store.reconcilePage(
        harness.item,
        0,
        [candidate],
        [bytes(9)],
        "replace-page",
        controller.signal,
      ),
      OperationCancelledError,
    );

    assert.equal(harness.io.readText(getManifestPath()), originalManifest);
    assert.deepEqual(
      harness.io.readBytes(seeded.results[0].imagePath),
      [1, 2, 3],
    );
  } finally {
    harness.restore();
  }
});

test("does not roll back a committed manifest when temporary cleanup fails", async () => {
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
    (harness.item as Zotero.Item & { version: number }).version = 2;
    const originalExists = IOUtils.exists.bind(IOUtils);
    const originalMove = IOUtils.move.bind(IOUtils);
    let manifestMoved = false;
    IOUtils.move = async (source: string, destination: string, options) => {
      const result = await originalMove(source, destination, options);
      if (destination === getManifestPath()) manifestMoved = true;
      return result;
    };
    IOUtils.exists = async (path: string) => {
      if (manifestMoved && path.includes("manifest.json.part-")) {
        throw new Error("simulated temporary cleanup failure");
      }
      return originalExists(path);
    };

    const updated = await store.reconcilePage(
      harness.item,
      0,
      [candidate],
      [bytes(9, 8)],
      "replace-page",
    );

    assert.equal(updated.skipped, 1);
    assert.deepEqual(harness.io.readBytes(seeded.results[0].imagePath), [9, 8]);
    assert.ok(await store.getReusablePageResults(harness.item, 0, [candidate]));
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

test("prunes skipped pages and results beyond the current PDF", async () => {
  const harness = installStoreHarness();
  const store = new FigureResultStore();
  const retained = makeCandidate({ pageIndex: 0 });
  const skipped = makeCandidate({
    comment: "Figure 2. Skipped",
    pageIndex: 1,
    tag: "Figure 2",
  });
  const removedPage = makeCandidate({
    comment: "Figure 4. Removed page",
    pageIndex: 3,
    tag: "Figure 4",
  });

  try {
    await store.reconcilePage(
      harness.item,
      0,
      [retained],
      [bytes(1)],
      "replace-page",
    );
    await store.reconcilePage(
      harness.item,
      1,
      [skipped],
      [bytes(2)],
      "replace-page",
    );
    await store.reconcilePage(
      harness.item,
      3,
      [removedPage],
      [bytes(4)],
      "replace-page",
    );
    const before = await store.list(harness.item);
    const removedPaths = before
      .filter(({ pageIndex }) => pageIndex !== 0)
      .map(({ imagePath }) => imagePath);
    const retainedPath = before.find(
      ({ pageIndex }) => pageIndex === 0,
    )!.imagePath;

    const pruned = await store.pruneAfterAnalysis(harness.item, 3, [1]);

    assert.equal(pruned.removed, 2);
    assert.deepEqual(pruned.removedPageIndices, [1, 3]);
    assert.deepEqual(
      (await store.list(harness.item)).map(({ id }) => id),
      [getFigureResultID(retained)],
    );
    for (const path of removedPaths)
      assert.equal(harness.io.exists(path), false);
    assert.equal(harness.io.exists(retainedPath), true);
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
    assert.equal(manifest.schemaVersion, 6);
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
    assert.equal(manifest.schemaVersion, 6);
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

test("persists formula LaTeX, preserves it on cache hits, and clears it after a crop change", async () => {
  const harness = installStoreHarness();
  const store = new FigureResultStore();
  const candidate = makeCandidate({
    comment: "Formula 1",
    tag: "Formula 1",
  });

  try {
    const seeded = await store.reconcilePage(
      harness.item,
      0,
      [candidate],
      [bytes(1, 2, 3)],
      "replace-page",
    );
    const original = seeded.results[0];
    const recognitionInput = await store.readFormulaRecognitionInput(
      harness.item,
      original.id,
    );
    assert.deepEqual([...recognitionInput!.image], [1, 2, 3]);
    const imageIdentity = recognitionInput!.imageIdentity;
    const updated = await store.updateFormulaLatex(
      harness.item,
      original.id,
      "  x^2 + y^2  ",
      imageIdentity,
    );
    assert.equal(updated?.latex, "x^2 + y^2");
    const editState = await store.readFormulaLatexState(
      harness.item,
      original.id,
    );
    assert.equal(editState?.imageIdentity, imageIdentity);
    assert.equal(editState?.latex, "x^2 + y^2");
    assert.equal(editState?.result.id, original.id);
    assert.equal((await store.list(harness.item))[0].latex, "x^2 + y^2");
    await assert.rejects(
      store.updateFormulaLatex(
        harness.item,
        original.id,
        "stale cloud result",
        imageIdentity,
        null,
      ),
      /LaTeX changed during recognition/,
    );
    assert.equal((await store.list(harness.item))[0].latex, "x^2 + y^2");

    const repeated = await store.reconcilePage(
      harness.item,
      0,
      [candidate],
      [bytes(9)],
      "replace-page",
    );
    assert.equal(repeated.results[0].latex, "x^2 + y^2");

    (harness.item as Zotero.Item & { version: number }).version = 2;
    const refreshed = await store.reconcilePage(
      harness.item,
      0,
      [candidate],
      [bytes(6, 7)],
      "replace-page",
    );
    assert.equal(refreshed.results[0].latex, undefined);
    assert.deepEqual(harness.io.readBytes(original.imagePath), [6, 7]);
    await assert.rejects(
      store.updateFormulaLatex(
        harness.item,
        original.id,
        "stale source result",
        imageIdentity,
      ),
      /image changed/,
    );

    const corrected = await store.updateRegion(
      harness.item,
      original.id,
      [2, 3, 11, 13],
      bytes(8),
    );
    assert.equal(corrected?.latex, undefined);
    await assert.rejects(
      store.updateFormulaLatex(
        harness.item,
        original.id,
        "stale",
        imageIdentity,
      ),
      /image changed/,
    );
  } finally {
    harness.restore();
  }
});

test("rejects empty LaTeX and LaTeX updates for non-formula results", async () => {
  const harness = installStoreHarness();
  const store = new FigureResultStore();
  try {
    const seeded = await store.reconcilePage(
      harness.item,
      0,
      [makeCandidate()],
      [bytes(1)],
      "replace-page",
    );
    await assert.rejects(
      store.updateFormulaLatex(harness.item, seeded.results[0].id, "  "),
      /LaTeX is empty/,
    );
    await assert.rejects(
      store.updateFormulaLatex(harness.item, seeded.results[0].id, "x"),
      /only be saved for formula/,
    );
  } finally {
    harness.restore();
  }
});

test("does not overwrite a corrected PNG when its rollback backup cannot be read", async () => {
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
    const originalManifest = harness.io.readText(getManifestPath());
    const originalRead = IOUtils.read.bind(IOUtils);
    IOUtils.read = async (path: string) => {
      if (path === imagePath) throw new Error("simulated backup read failure");
      return originalRead(path);
    };

    await assert.rejects(
      store.updateRegion(
        harness.item,
        seeded.results[0].id,
        [2, 3, 12, 14],
        bytes(9),
      ),
      /simulated backup read failure/,
    );

    assert.equal(harness.io.readText(getManifestPath()), originalManifest);
    assert.deepEqual(harness.io.readBytes(imagePath), [1, 2, 3]);
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
    assert.equal(upgraded.schemaVersion, 6);

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
    assert.equal(upgraded.schemaVersion, 6);
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
    logError: () => undefined,
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
