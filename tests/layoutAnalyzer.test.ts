import * as assert from "node:assert/strict";
import test from "node:test";
import type {
  AnnotationCandidate,
  LayoutElement,
  Rect,
} from "../src/domain/layout";
import type { PdfReader } from "../src/platform/zotero/reader";
import { LayoutAnalyzer } from "../src/services/layout/layoutAnalyzer";
import {
  DEFAULT_FIGURE_RESULT_ANALYSIS_IDENTITY,
  FigureResultStore,
} from "../src/services/results/figureResultStore";
import type { PdfEngine } from "../src/services/pdf/pdfEngine";
import { RECOMMENDED_MODEL } from "../src/services/model/modelCatalog";
import { modelManager } from "../src/services/model/modelManager";
import { OperationCancelledError } from "../src/utils/cancellation";
import { installMemoryIO } from "./helpers/memoryIO";

class AnalyzerWorker {
  public static automatic = true;
  public static readonly instances: AnalyzerWorker[] = [];
  public onerror: ((event: ErrorEvent) => unknown) | null = null;
  public onmessage: ((event: MessageEvent) => unknown) | null = null;
  public readonly messages: Array<{ taskID?: number; type: string }> = [];
  public terminated = false;
  private readonly respondedTasks = new Set<number>();

  public constructor() {
    AnalyzerWorker.instances.push(this);
  }

  public postMessage(message: { taskID?: number; type: string }): void {
    this.messages.push(message);
    if (message.type === "INIT") {
      queueMicrotask(() => this.respond({ type: "READY" }));
      return;
    }
    if (message.type === "DETECT" && AnalyzerWorker.automatic) {
      queueMicrotask(() => this.respondToDetection(message.taskID as number));
    }
  }

  public get detectionMessages(): Array<{ taskID?: number; type: string }> {
    return this.messages.filter(({ type }) => type === "DETECT");
  }

  public get respondedDetectionCount(): number {
    return this.respondedTasks.size;
  }

  public respondToNextDetection(): boolean {
    const message = this.detectionMessages.find(
      ({ taskID }) => taskID !== undefined && !this.respondedTasks.has(taskID),
    );
    if (message?.taskID === undefined) return false;
    this.respondToDetection(message.taskID);
    return true;
  }

  public terminate(): void {
    this.terminated = true;
  }

  private respondToDetection(taskID: number): void {
    if (this.respondedTasks.has(taskID)) return;
    this.respondedTasks.add(taskID);
    this.respond({
      results: detectionResults,
      taskID,
      timings: {
        decodeMs: 1,
        inferenceMs: 3,
        postprocessMs: 4,
        preprocessMs: 2,
        totalMs: 10,
      },
      type: "RESULT",
    });
  }

  private respond(data: Record<string, unknown>): void {
    this.onmessage?.({ data } as MessageEvent);
  }
}

const detectionResults: LayoutElement[] = [
  { score: 0.9, type: "figure", xyxy: [0.1, 0.2, 0.8, 0.8] },
  {
    score: 0.9,
    type: "figure_caption",
    xyxy: [0.1, 0.82, 0.8, 0.95],
  },
];

test("analysis renders one high-resolution page for all local previews", async () => {
  const harness = installAnalyzerHarness();
  const analyzer = new LayoutAnalyzer(undefined, harness.pdfEngine, 1);
  try {
    const summary = await analyzer.analyze(harness.reader, { update() {} });

    assert.equal(summary.pagesAnalyzed, 1);
    assert.equal(summary.resultsCreated, 1);
    assert.equal(summary.annotationsCreated, 0);
    assert.equal(harness.annotationWrites(), 0);
    assert.equal(harness.renderedPreviewPageCount(), 1);
    assert.equal(summary.timings.workerDecodeMs, 1);
    assert.equal(summary.timings.preprocessMs, 2);
    assert.equal(summary.timings.inferenceMs, 3);
    assert.equal(summary.timings.postprocessMs, 4);
    assert.equal(summary.timings.workerTotalMs, 10);
    assert.equal(summary.timings.previewPageRenderMs, 2);
    assert.equal(summary.timings.cropEncodingMs, 1);
    const completionLogs = harness
      .logs()
      .filter(([message]) => message === "Layout analysis completed");
    assert.equal(completionLogs.length, 1);
    const timingLog = completionLogs[0][1] as {
      pages: { analyzed: number; total: number };
      parsingMs: { inference: number; preprocess: number };
      results: { created: number };
      screenshotMs: { pngCropEncode: number; previewPageRender: number };
      storageMs: { imageWrite: number; manifestWrite: number };
      wallMs: number;
    };
    assert.deepEqual(timingLog.pages, {
      analyzed: 1,
      failed: 0,
      skipped: 0,
      total: 1,
    });
    assert.equal(timingLog.results.created, 1);
    assert.equal(timingLog.parsingMs.preprocess, 2);
    assert.equal(timingLog.parsingMs.inference, 3);
    assert.equal(timingLog.screenshotMs.previewPageRender, 2);
    assert.equal(timingLog.screenshotMs.pngCropEncode, 1);
    assert.ok(timingLog.storageMs.imageWrite >= 0);
    assert.ok(timingLog.storageMs.manifestWrite >= 0);
    assert.ok(Number.isFinite(timingLog.wallMs));
    assert.ok(timingLog.wallMs >= 0);
  } finally {
    analyzer.dispose();
    harness.restore();
  }
});

test("does not persist a low-resolution fallback when region rendering fails", async () => {
  const harness = installAnalyzerHarness({ previewRenderer: false });
  const analyzer = new LayoutAnalyzer(undefined, harness.pdfEngine, 1);
  try {
    await assert.rejects(analyzer.analyze(harness.reader, { update() {} }));
    assert.equal(harness.renderedPreviewPageCount(), 0);
  } finally {
    analyzer.dispose();
    harness.restore();
  }
});

test("reuses versioned local previews on repeated analysis", async () => {
  const harness = installAnalyzerHarness();
  const analyzer = new LayoutAnalyzer(undefined, harness.pdfEngine, 1);
  try {
    await analyzer.analyze(harness.reader, { update() {} });
    const repeated = await analyzer.analyze(harness.reader, { update() {} });

    assert.equal(harness.renderedPreviewPageCount(), 1);
    assert.equal(repeated.resultsCreated, 0);
    assert.equal(repeated.resultsSkipped, 1);
    assert.equal(repeated.timings.previewRenderingMs, 0);
    assert.equal(repeated.timings.imageWriteMs, 0);
    const repeatedLog = harness
      .logs()
      .filter(([message]) => message === "Layout analysis completed")
      .at(-1)?.[1] as {
      screenshotMs: { previewPageRender: number };
      storageMs: { imageWrite: number };
    };
    assert.equal(repeatedLog.screenshotMs.previewPageRender, 0);
    assert.equal(repeatedLog.storageMs.imageWrite, 0);
  } finally {
    analyzer.dispose();
    harness.restore();
  }
});

test("rerenders a manual crop when the preview cache identity changes", async () => {
  const harness = installAnalyzerHarness();
  const originalStore = new FigureResultStore();
  const originalAnalyzer = new LayoutAnalyzer(
    originalStore,
    harness.pdfEngine,
    1,
  );
  const refreshedStore = new FigureResultStore({
    analysisIdentity: {
      ...DEFAULT_FIGURE_RESULT_ANALYSIS_IDENTITY,
      previewVersion: "manual-crop-regression-v2",
    },
  });
  const refreshedAnalyzer = new LayoutAnalyzer(
    refreshedStore,
    harness.pdfEngine,
    1,
  );
  try {
    await originalAnalyzer.analyze(harness.reader, { update() {} });
    const [detected] = await originalStore.list(harness.reader._item);
    const correctedRect: Rect = [
      detected.rect[0] + 2,
      detected.rect[1] + 3,
      detected.rect[2] - 4,
      detected.rect[3] - 5,
    ];
    const corrected = await originalStore.updateRegion(
      harness.reader._item,
      detected.id,
      correctedRect,
      Uint8Array.of(9, 8).buffer,
    );
    assert.deepEqual(corrected?.rect, correctedRect);

    (harness.reader._item as Zotero.Item & { version: number }).version = 2;
    const refreshed = await refreshedAnalyzer.analyze(harness.reader, {
      update() {},
    });

    assert.equal(refreshed.resultsCreated, 0);
    assert.equal(refreshed.resultsSkipped, 1);
    assert.equal(harness.renderedPreviewPageCount(), 2);
    assert.deepEqual(harness.renderedRegionRects.at(-1), [correctedRect]);
    const [stored] = await refreshedStore.list(harness.reader._item);
    assert.deepEqual(stored.rect, correctedRect);
    assert.deepEqual(stored.detectedRect, detected.rect);
    assert.deepEqual(
      Array.from(await IOUtils.read(stored.imagePath)),
      [137, 80, 78, 71],
    );
  } finally {
    originalAnalyzer.dispose();
    refreshedAnalyzer.dispose();
    harness.restore();
  }
});

test("mirrors a persisted manual caption instead of the detected caption", async () => {
  const harness = installAnalyzerHarness({ allowAnnotations: true });
  const store = new FigureResultStore();
  const analyzer = new LayoutAnalyzer(store, harness.pdfEngine, 1);
  try {
    await analyzer.analyze(harness.reader, { update() {} });
    const [stored] = await store.list(harness.reader._item);
    await store.updateComment(
      harness.reader._item,
      stored.id,
      "Figure 1. Manually corrected",
    );

    const summary = await analyzer.analyze(
      harness.reader,
      { update() {} },
      { syncAnnotations: true },
    );

    assert.equal(summary.annotationsCreated, 1);
    assert.deepEqual(harness.annotationComments(), [
      "Figure 1. Manually corrected",
    ]);
  } finally {
    analyzer.dispose();
    harness.restore();
  }
});

test("maps a corrected preview rectangle back to PDF coordinates", async () => {
  const harness = installAnalyzerHarness();
  const store = new FigureResultStore();
  const analyzer = new LayoutAnalyzer(store, harness.pdfEngine, 1);
  const candidate: AnnotationCandidate = {
    comment: "Figure 1. Caption",
    pageIndex: 0,
    rect: [1, 2, 10, 12],
    tag: "Figure 1",
  };
  try {
    const seeded = await store.reconcilePage(
      harness.reader._item,
      0,
      [candidate],
      [Uint8Array.of(1).buffer],
      "replace-page",
    );
    const preview = await analyzer.createResultCorrectionPreview(
      harness.reader._item,
      seeded.results[0],
    );
    assert.deepEqual(preview.rect, [0.01, 0.88, 0.1, 0.98]);

    const updated = await analyzer.correctResultRegion(
      harness.reader._item,
      seeded.results[0],
      [0.2, 0.3, 0.6, 0.7],
    );
    assert.deepEqual(updated?.rect, [20, 30, 60, 70]);
    assert.deepEqual(harness.renderedRegionRects.at(-1), [[20, 30, 60, 70]]);
  } finally {
    analyzer.dispose();
    harness.restore();
  }
});

test("overlaps the second page but waits for a permit before rendering the third", async () => {
  const harness = installAnalyzerHarness({ automatic: false, pageCount: 3 });
  const analyzer = new LayoutAnalyzer(undefined, harness.pdfEngine, 1);
  const controller = new AbortController();
  const progress: number[] = [];
  const analysis = analyzer.analyze(
    harness.reader,
    { update: (_text, value) => progress.push(value) },
    { signal: controller.signal },
  );
  try {
    await waitFor(() => harness.renderedPages.length === 2);
    await flushTasks();

    assert.deepEqual(harness.renderedPages, [0, 1]);
    assert.equal(AnalyzerWorker.instances.length, 1);
    const worker = harness.worker();
    assert.equal(worker.detectionMessages.length, 1);

    worker.respondToNextDetection();
    await waitFor(() => harness.renderedPages.length === 3);
    assert.deepEqual(harness.renderedPages, [0, 1, 2]);

    await completeDetections(worker, 3);
    const summary = await analysis;
    assert.equal(summary.pagesAnalyzed, 3);
    assert.equal(progress.at(-1), 100);
    assert.ok(
      progress.every(
        (value, index) => index === 0 || value >= progress[index - 1],
      ),
    );
  } finally {
    controller.abort();
    await analysis.catch(() => undefined);
    analyzer.dispose();
    harness.restore();
  }
});

test("shares the two-page detection limit across concurrent readers", async () => {
  const harness = installAnalyzerHarness({
    automatic: false,
    pageCount: 2,
    readerCount: 2,
  });
  const analyzer = new LayoutAnalyzer(undefined, harness.pdfEngine, 1);
  const controller = new AbortController();
  const analyses = harness.readers.map((reader) =>
    analyzer.analyze(reader, { update() {} }, { signal: controller.signal }),
  );
  try {
    await waitFor(() => harness.renderedPages.length === 2);
    await flushTasks();
    assert.equal(harness.renderedPages.length, 2);

    const worker = harness.worker();
    assert.equal(AnalyzerWorker.instances.length, 1);
    assert.equal(worker.detectionMessages.length, 1);
    worker.respondToNextDetection();
    await waitFor(() => harness.renderedPages.length === 3);

    await completeDetections(worker, 4);
    const summaries = await Promise.all(analyses);
    assert.deepEqual(
      summaries.map(({ pagesAnalyzed }) => pagesAnalyzed),
      [2, 2],
    );
  } finally {
    controller.abort();
    await Promise.all(
      analyses.map((analysis) => analysis.catch(() => undefined)),
    );
    analyzer.dispose();
    harness.restore();
  }
});

test("cancels active and permit-waiting pages as OperationCancelledError", async () => {
  const harness = installAnalyzerHarness({ automatic: false, pageCount: 3 });
  const analyzer = new LayoutAnalyzer(undefined, harness.pdfEngine, 1);
  const controller = new AbortController();
  const analysis = analyzer.analyze(
    harness.reader,
    { update() {} },
    { signal: controller.signal },
  );
  try {
    await waitFor(() => harness.renderedPages.length === 2);
    const activeWorker = harness.worker();
    await waitFor(() => activeWorker.detectionMessages.length === 1);
    controller.abort();

    await assert.rejects(analysis, OperationCancelledError);
    await flushTasks();
    assert.deepEqual(harness.renderedPages, [0, 1]);
    assert.equal(activeWorker.terminated, true);
    assert.equal(
      harness
        .logs()
        .some(([message]) => message === "Layout analysis completed"),
      false,
    );
  } finally {
    controller.abort();
    await analysis.catch(() => undefined);
    analyzer.dispose();
    harness.restore();
  }
});

interface AnalyzerHarnessOptions {
  allowAnnotations?: boolean;
  automatic?: boolean;
  pageCount?: number;
  previewRenderer?: boolean;
  readerCount?: number;
}

function installAnalyzerHarness(options: AnalyzerHarnessOptions = {}): {
  annotationComments(): readonly string[];
  annotationWrites(): number;
  logs(): readonly (readonly unknown[])[];
  pdfEngine: PdfEngine;
  reader: PdfReader;
  readers: PdfReader[];
  renderedPages: number[];
  renderedRegionRects: Rect[][];
  renderedPreviewPageCount(): number;
  restore(): void;
  worker(): AnalyzerWorker;
} {
  const previousZotero = globalThis.Zotero;
  const previousWorker = globalThis.Worker;
  const previousAddon = (globalThis as any).addon;
  const previousZtoolkit = (globalThis as any).ztoolkit;
  const originalEnsureModel = modelManager.ensureRecommendedModel;
  const io = installMemoryIO();
  io.writeBytes("/data/zotero-figure/models/model.onnx", Uint8Array.of(1));
  let writes = 0;
  const annotationComments: string[] = [];
  const logs: unknown[][] = [];
  let renderedPreviewPages = 0;
  const renderedPages: number[] = [];
  const renderedRegionRects: Rect[][] = [];

  AnalyzerWorker.automatic = options.automatic ?? true;
  AnalyzerWorker.instances.length = 0;

  globalThis.Worker = AnalyzerWorker as unknown as typeof Worker;
  (globalThis as any).addon = { data: {} };
  (globalThis as any).ztoolkit = {
    log(...values: unknown[]) {
      logs.push(values);
    },
  };
  globalThis.Zotero = {
    Annotations: {
      saveFromJSON: async (
        _item: Zotero.Item,
        annotation: { comment: string },
      ) => {
        writes++;
        if (!options.allowAnnotations) {
          throw new Error("Annotation mirroring should be opt-in");
        }
        annotationComments.push(annotation.comment);
        return {
          saveTx: async () => undefined,
          setTags: () => undefined,
        } as unknown as Zotero.Item;
      },
    },
    DataDirectory: { dir: "/data" },
    Prefs: { get: () => "replace-page" },
    Utilities: { generateObjectKey: () => "ANNOTATION-KEY" },
  } as unknown as typeof Zotero;
  modelManager.ensureRecommendedModel = async () => ({
    hash: RECOMMENDED_MODEL.sha256,
    path: "/data/zotero-figure/models/model.onnx",
    size: RECOMMENDED_MODEL.size,
    state: "valid",
    variant: RECOMMENDED_MODEL,
  });

  const readers = Array.from(
    { length: options.readerCount ?? 1 },
    (_, readerIndex) =>
      ({
        _internalReader: {
          _lastView: {
            _iframeWindow: {
              PDFViewerApplication: { pagesCount: options.pageCount ?? 1 },
              eval: async (source: string) => {
                if (source.includes("GetPageData")) {
                  return {
                    chars: [
                      {
                        c: "Figure 1. Caption",
                        rect: [10, 5, 80, 18],
                      },
                    ],
                    viewBox: [0, 0, 100, 100],
                  };
                }
                if (
                  source.includes("__zoteroFigureRenderJobs") &&
                  source.includes("const input =")
                ) {
                  if (options.previewRenderer === false) {
                    throw new Error("Preview rendering unavailable");
                  }
                  renderedPreviewPages++;
                  return {
                    cropEncodingMs: 1,
                    failedIndices: [],
                    images: [Uint8Array.from([137, 80, 78, 71]).buffer],
                    pageRenderMs: 2,
                    pixelCount: 160_000,
                    scale: 4,
                  };
                }
                const pageNumber = Number(
                  source.match(/getPage\(\s*(\d+)\s*\)/)?.[1],
                );
                if (!Number.isInteger(pageNumber) || pageNumber < 1) {
                  throw new Error("Unable to identify rendered test page");
                }
                renderedPages.push(pageNumber - 1);
                return Uint8Array.from([1, 2, 3]).buffer;
              },
            },
          },
          _primaryView: {},
        },
        _item: {
          getAnnotations: () => [],
          id: readerIndex + 1,
          key: `ATTACHMENT-${readerIndex + 1}`,
          libraryID: 1,
        },
      }) as unknown as PdfReader,
  );

  const pdfEngine: PdfEngine = {
    dispose() {},
    async prepare() {},
    async open() {
      return {
        pageCount: options.pageCount ?? 1,
        async close() {},
        async getPageData() {
          return {
            chars: [
              {
                c: "Figure 1. Caption",
                rect: [10, 5, 80, 18],
              },
            ],
            pageBounds: [0, 0, 100, 100],
            pdfToPage: [1, 0, 0, -1, 0, 100],
            pageToPdf: [1, 0, 0, -1, 0, 100],
            viewBox: [0, 0, 100, 100],
          };
        },
        async renderDetectionImage(pageIndex) {
          renderedPages.push(pageIndex);
          return {
            encodeMs: 1,
            image: Uint8Array.from([1, 2, 3]).buffer,
            pixelCount: 409_600,
            renderMs: 1,
          };
        },
        async renderRegions(_pageIndex, rects) {
          if (options.previewRenderer === false) {
            throw new Error("Preview rendering unavailable");
          }
          renderedRegionRects.push(rects.map((rect) => [...rect] as Rect));
          renderedPreviewPages++;
          return {
            encodeMs: 1,
            images: [Uint8Array.from([137, 80, 78, 71]).buffer],
            maxScale: 4,
            pixelCount: 160_000,
            renderMs: 2,
          };
        },
      };
    },
  };

  return {
    annotationComments: () => annotationComments,
    annotationWrites: () => writes,
    logs: () => logs,
    pdfEngine,
    reader: readers[0],
    readers,
    renderedPages,
    renderedRegionRects,
    renderedPreviewPageCount: () => renderedPreviewPages,
    restore: () => {
      modelManager.ensureRecommendedModel = originalEnsureModel;
      io.restore();
      globalThis.Zotero = previousZotero;
      globalThis.Worker = previousWorker;
      (globalThis as any).addon = previousAddon;
      (globalThis as any).ztoolkit = previousZtoolkit;
      AnalyzerWorker.instances.length = 0;
    },
    worker: () => {
      const worker = AnalyzerWorker.instances[0];
      if (!worker) throw new Error("Analyzer worker was not initialized");
      return worker;
    },
  };
}

async function completeDetections(
  worker: AnalyzerWorker,
  expected: number,
): Promise<void> {
  while (worker.respondedDetectionCount < expected) {
    await waitFor(
      () => worker.detectionMessages.length > worker.respondedDetectionCount,
    );
    assert.equal(worker.respondToNextDetection(), true);
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await flushTasks();
  }
  assert.fail("Timed out while waiting for analyzer test state");
}

async function flushTasks(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  await new Promise<void>((resolve) => setImmediate(resolve));
}
