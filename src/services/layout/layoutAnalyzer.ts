import { config } from "../../../package.json";
import {
  buildAnnotationCandidates,
  pageMayContainFigures,
  type AnnotationCandidate,
  type PageLayoutData,
} from "../../domain/layout";
import {
  reconcileGeneratedAnnotations,
  type DuplicateMode,
} from "../../platform/zotero/annotations";
import {
  getPageCount,
  getPageData,
  renderPageImage,
  renderPageImageCrops,
  type PdfReader,
} from "../../platform/zotero/reader";
import {
  isCancellationError,
  OperationCancelledError,
  throwIfAborted,
} from "../../utils/cancellation";
import { getString } from "../../utils/locale";
import { getPref } from "../../utils/prefs";
import { MODEL_NAME, type ModelVariant } from "../model/modelCatalog";
import { modelManager } from "../model/modelManager";
import { LayoutWorkerPool } from "./workerPool";
import { cropPageImage } from "./pageImageCropper";
import {
  FigureResultStore,
  type FigureResultStoreReconcile,
} from "../results/figureResultStore";

export interface AnalysisProgress {
  update(text: string, progress: number): void;
}

export interface AnalysisSummary {
  annotationsCreated: number;
  annotationsRemoved: number;
  annotationsSkipped: number;
  failedPages: number;
  pagesAnalyzed: number;
  pagesSkipped: number;
  resultsCreated: number;
  resultsRemoved: number;
  resultsSkipped: number;
  timings: AnalysisTimings;
  totalPages: number;
}

export interface AnalysisTimings {
  annotationMs: number;
  annotationStageWaitMs: number;
  cacheLookupMs: number;
  cropEncodingMs: number;
  detectionMs: number;
  detectionRenderWaitMs: number;
  detectionStageWaitMs: number;
  eventLoopLagMaxMs: number;
  eventLoopLongTaskCount: number;
  imageWriteMs: number;
  inferenceMs: number;
  lockWaitMs: number;
  manifestWriteMs: number;
  modelPreparationMs: number;
  pageDataMs: number;
  postprocessMs: number;
  preprocessMs: number;
  previewFallbackMs: number;
  previewMaxScale: number;
  previewPageRenderMs: number;
  previewPdfRenderWaitMs: number;
  previewPeakPixels: number;
  previewRenderingMs: number;
  previewStageWaitMs: number;
  renderingMs: number;
  sourceFingerprintMs: number;
  storageMs: number;
  storageStageWaitMs: number;
  totalMs: number;
  workerDecodeMs: number;
  workerQueueMs: number;
  workerPreparationMs: number;
  workerTotalMs: number;
}

export interface AnalysisOptions {
  signal?: AbortSignal;
  syncAnnotations?: boolean;
}

interface PageOutcome {
  annotationMs: number;
  annotationStageWaitMs: number;
  annotationsCreated: number;
  annotationsRemoved: number;
  annotationsSkipped: number;
  cacheLookupMs: number;
  created: number;
  cropEncodingMs: number;
  detectionMs: number;
  detectionRenderWaitMs: number;
  detectionStageWaitMs: number;
  failed: boolean;
  imageWriteMs: number;
  inferenceMs: number;
  lockWaitMs: number;
  manifestWriteMs: number;
  postprocessMs: number;
  preprocessMs: number;
  previewFallbackMs: number;
  previewMaxScale: number;
  previewPageRenderMs: number;
  previewPdfRenderWaitMs: number;
  previewPeakPixels: number;
  previewRenderingMs: number;
  previewStageWaitMs: number;
  removed: number;
  renderingMs: number;
  resultsCreated: number;
  resultsRemoved: number;
  resultsSkipped: number;
  skipped: number;
  storageMs: number;
  storageStageWaitMs: number;
  workerDecodeMs: number;
  workerQueueMs: number;
  workerTotalMs: number;
}

const LAYOUT_WORKER_COUNT = 1;
// At most one 12 MP preview canvas (~46 MiB RGBA), one page of encoded crops,
// and one detection page/tensor may coexist. Keep this bound in sync with the
// memory analysis in docs/PERFORMANCE.md.
const MAX_SCHEDULED_PAGES = 3;
const MAX_DETECTION_PAGES = 2;
const MAX_PDF_RENDERS = 1;
const MAX_PREVIEW_PAGES = 1;
const MAX_STORAGE_PAGES = 1;
const MAX_ANNOTATION_PAGES = 1;
const NO_PAGE_TASK_ERROR = Symbol("no-page-task-error");
const SCAN_PROGRESS_WEIGHT = 0.2;

export class LayoutAnalyzer {
  private readonly scheduledPages = new PagePipelineLimiter(
    MAX_SCHEDULED_PAGES,
  );
  private readonly detectionPages = new PagePipelineLimiter(
    MAX_DETECTION_PAGES,
  );
  private readonly pdfRenders = new PagePipelineLimiter(MAX_PDF_RENDERS);
  private readonly previewPages = new PagePipelineLimiter(MAX_PREVIEW_PAGES);
  private readonly storagePages = new PagePipelineLimiter(MAX_STORAGE_PAGES);
  private readonly annotationPages = new PagePipelineLimiter(
    MAX_ANNOTATION_PAGES,
  );
  private workerPool?: LayoutWorkerPool;
  private workerPoolKey?: string;

  constructor(private readonly resultStore = new FigureResultStore()) {}

  public async prewarm(): Promise<void> {
    const validation = await modelManager.ensureRecommendedModel();
    if (validation.state !== "valid") return;
    await this.getWorkerPool(validation.path, validation.variant).prepare();
  }

  public dispose(): void {
    this.workerPool?.dispose();
    this.workerPool = undefined;
    this.workerPoolKey = undefined;
  }

  public async analyze(
    reader: PdfReader,
    progress: AnalysisProgress,
    options: AnalysisOptions = {},
  ): Promise<AnalysisSummary> {
    const analysisStartedAt = Date.now();
    const timings: AnalysisTimings = {
      annotationMs: 0,
      annotationStageWaitMs: 0,
      cacheLookupMs: 0,
      cropEncodingMs: 0,
      detectionMs: 0,
      detectionRenderWaitMs: 0,
      detectionStageWaitMs: 0,
      eventLoopLagMaxMs: 0,
      eventLoopLongTaskCount: 0,
      imageWriteMs: 0,
      inferenceMs: 0,
      lockWaitMs: 0,
      manifestWriteMs: 0,
      modelPreparationMs: 0,
      pageDataMs: 0,
      postprocessMs: 0,
      preprocessMs: 0,
      previewFallbackMs: 0,
      previewMaxScale: 0,
      previewPageRenderMs: 0,
      previewPdfRenderWaitMs: 0,
      previewPeakPixels: 0,
      previewRenderingMs: 0,
      previewStageWaitMs: 0,
      renderingMs: 0,
      sourceFingerprintMs: 0,
      storageMs: 0,
      storageStageWaitMs: 0,
      totalMs: 0,
      workerDecodeMs: 0,
      workerQueueMs: 0,
      workerPreparationMs: 0,
      workerTotalMs: 0,
    };
    const { signal } = options;
    const syncAnnotations = options.syncAnnotations === true;
    throwIfAborted(signal);
    const modelStartedAt = Date.now();
    const validation = await modelManager.ensureRecommendedModel({ signal });
    timings.modelPreparationMs = Date.now() - modelStartedAt;
    throwIfAborted(signal);
    if (validation.state === "missing") {
      throw new Error(getString("error-model-file-unavailable"));
    }
    if (validation.state === "invalid") {
      throw new Error(getString("error-model-integrity"));
    }

    const totalPages = getPageCount(reader);
    const sourceFingerprintStartedAt = Date.now();
    const sourceFingerprint = await this.resultStore.getSourceFingerprint(
      reader._item,
      signal,
    );
    timings.sourceFingerprintMs = Date.now() - sourceFingerprintStartedAt;
    const duplicateMode = getDuplicateMode();
    const workerPool = this.getWorkerPool(validation.path, validation.variant);
    const workerStartedAt = Date.now();
    await workerPool.prepare(signal);
    timings.workerPreparationMs = Date.now() - workerStartedAt;

    const operationController = new AbortController();
    const abortOperation = () => operationController.abort();
    signal?.addEventListener("abort", abortOperation, { once: true });
    if (signal?.aborted) abortOperation();
    const operationSignal = operationController.signal;

    const summary: AnalysisSummary = {
      annotationsCreated: 0,
      annotationsRemoved: 0,
      annotationsSkipped: 0,
      failedPages: 0,
      pagesAnalyzed: 0,
      pagesSkipped: 0,
      resultsCreated: 0,
      resultsRemoved: 0,
      resultsSkipped: 0,
      timings,
      totalPages,
    };
    let completedPages = 0;
    let completed = false;
    let lastProgress = 0;
    let pageTaskError: unknown | typeof NO_PAGE_TASK_ERROR = NO_PAGE_TASK_ERROR;
    const pendingPageTasks = new Set<Promise<void>>();
    const report = (text: string, value: number) => {
      lastProgress = Math.max(lastProgress, Math.min(100, value));
      progress.update(text, lastProgress);
    };

    const responsiveness = new EventLoopResponsivenessMonitor();
    responsiveness.start();
    try {
      try {
        for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
          throwIfAborted(operationSignal);
          if (pageTaskError !== NO_PAGE_TASK_ERROR) throw pageTaskError;
          report(
            getString("progress-exporting", {
              args: { current: pageIndex + 1, total: totalPages },
            }),
            ((pageIndex + 1) / totalPages) * 100 * SCAN_PROGRESS_WEIGHT,
          );

          const pageDataStartedAt = Date.now();
          const page = await getPageData(reader, pageIndex);
          timings.pageDataMs += Date.now() - pageDataStartedAt;
          throwIfAborted(operationSignal);
          if (!pageMayContainFigures(page.chars)) {
            summary.pagesSkipped++;
            completedPages++;
            reportDetectionProgress(report, completedPages, totalPages);
            await yieldToUI(operationSignal);
            continue;
          }

          const releasePage =
            await this.scheduledPages.acquire(operationSignal);
          let pageScheduled = false;
          try {
            throwIfAborted(operationSignal);
            if (pageTaskError !== NO_PAGE_TASK_ERROR) throw pageTaskError;
            const pageData = {
              chars: page.chars,
              height: page.viewBox[3] - page.viewBox[1],
              pageIndex,
              viewBox: page.viewBox,
              width: page.viewBox[2] - page.viewBox[0],
            };
            const pageTask = (async () => {
              try {
                const outcome = await this.processPage(
                  reader,
                  workerPool,
                  pageData,
                  sourceFingerprint,
                  duplicateMode,
                  syncAnnotations,
                  operationSignal,
                );
                completedPages++;
                mergeOutcomes(summary, [outcome]);
                reportDetectionProgress(report, completedPages, totalPages);
                await yieldToUI(operationSignal);
              } catch (error) {
                if (pageTaskError === NO_PAGE_TASK_ERROR) {
                  pageTaskError = error;
                }
                operationController.abort();
              } finally {
                releasePage();
              }
            })();
            pendingPageTasks.add(pageTask);
            void pageTask.then(
              () => pendingPageTasks.delete(pageTask),
              (error) => {
                if (pageTaskError === NO_PAGE_TASK_ERROR) {
                  pageTaskError = error;
                }
                pendingPageTasks.delete(pageTask);
                operationController.abort();
              },
            );
            pageScheduled = true;
          } finally {
            if (!pageScheduled) releasePage();
          }
        }

        await Promise.all(Array.from(pendingPageTasks));
        if (pageTaskError !== NO_PAGE_TASK_ERROR) throw pageTaskError;
        throwIfAborted(operationSignal);
        const relevantPages = summary.pagesAnalyzed + summary.failedPages;
        if (relevantPages > 0 && summary.failedPages === relevantPages) {
          throw new Error(
            getString("error-analysis-failed", {
              args: { count: summary.failedPages },
            }),
          );
        }
        completed = true;
        return summary;
      } catch (error) {
        operationController.abort();
        await Promise.all(Array.from(pendingPageTasks));
        const primaryError =
          pageTaskError !== NO_PAGE_TASK_ERROR &&
          !isCancellationError(pageTaskError)
            ? pageTaskError
            : error;
        if (signal?.aborted || isCancellationError(primaryError)) {
          throw new OperationCancelledError();
        }
        throw primaryError;
      }
    } finally {
      signal?.removeEventListener("abort", abortOperation);
      const responsivenessResult = responsiveness.stop();
      timings.eventLoopLagMaxMs = responsivenessResult.maximumLagMs;
      timings.eventLoopLongTaskCount = responsivenessResult.longTaskCount;
      timings.totalMs = Date.now() - analysisStartedAt;
      if (completed) {
        logAnalysisCompletion(reader, summary, syncAnnotations);
      }
    }
  }

  private async processPage(
    reader: PdfReader,
    workerPool: LayoutWorkerPool,
    page: Omit<PageLayoutData, "elements">,
    sourceFingerprint: string,
    duplicateMode: DuplicateMode,
    syncAnnotations: boolean,
    signal?: AbortSignal,
  ): Promise<PageOutcome> {
    let annotationMs = 0;
    let annotationStageWaitMs = 0;
    let cacheLookupMs = 0;
    let cropEncodingMs = 0;
    let detectionMs: number | undefined;
    let detectionRenderWaitMs = 0;
    let detectionStageWaitMs = 0;
    let imageWriteMs = 0;
    let inferenceMs = 0;
    let lockWaitMs = 0;
    let manifestWriteMs = 0;
    let postprocessMs = 0;
    let preprocessMs = 0;
    let previewFallbackMs = 0;
    let previewMaxScale = 0;
    let previewPageRenderMs = 0;
    let previewPdfRenderWaitMs = 0;
    let previewPeakPixels = 0;
    let previewRenderingMs = 0;
    let previewStageWaitMs = 0;
    let renderingMs = 0;
    let storageMs = 0;
    let storageStageWaitMs = 0;
    let workerDecodeMs = 0;
    let workerQueueMs = 0;
    let workerTotalMs = 0;
    const pageStartedAt = Date.now();
    try {
      const detectionWaitStartedAt = Date.now();
      const releaseDetection = await this.detectionPages.acquire(signal);
      detectionStageWaitMs = Date.now() - detectionWaitStartedAt;
      let elements: PageLayoutData["elements"];
      try {
        const renderWaitStartedAt = Date.now();
        const releaseRender = await this.pdfRenders.acquire(signal);
        detectionRenderWaitMs = Date.now() - renderWaitStartedAt;
        let image: ArrayBuffer;
        try {
          const renderingStartedAt = Date.now();
          image = await renderPageImage(reader, page.pageIndex, page.viewBox);
          renderingMs = Date.now() - renderingStartedAt;
        } finally {
          releaseRender();
        }
        await yieldToUI(signal);
        const detectionStartedAt = Date.now();
        const detection = await workerPool.detectWithTiming(
          image,
          page.pageIndex,
          signal,
        );
        elements = detection.elements;
        workerDecodeMs = detection.timings.decodeMs;
        workerQueueMs = detection.timings.queueMs;
        preprocessMs = detection.timings.preprocessMs;
        inferenceMs = detection.timings.inferenceMs;
        postprocessMs = detection.timings.postprocessMs;
        workerTotalMs = detection.timings.totalMs;
        detectionMs = Date.now() - detectionStartedAt;
      } finally {
        releaseDetection();
      }
      throwIfAborted(signal);
      const candidates = buildAnnotationCandidates({ ...page, elements });
      const cacheLookupStartedAt = Date.now();
      const reusableResults = await this.resultStore.getReusablePageResults(
        reader._item,
        page.pageIndex,
        candidates,
        signal,
        sourceFingerprint,
      );
      cacheLookupMs = Date.now() - cacheLookupStartedAt;
      let resultImages: ArrayBuffer[] = [];
      if (!reusableResults) {
        const previewWaitStartedAt = Date.now();
        const releasePreview = await this.previewPages.acquire(signal);
        previewStageWaitMs = Date.now() - previewWaitStartedAt;
        const previewStartedAt = Date.now();
        let releasePdfRender: (() => void) | undefined;
        try {
          const pdfRenderWaitStartedAt = Date.now();
          releasePdfRender = await this.pdfRenders.acquire(signal);
          previewPdfRenderWaitMs = Date.now() - pdfRenderWaitStartedAt;
          const rendered = await this.renderResultImages(
            reader,
            candidates,
            page,
            signal,
          );
          resultImages = rendered.images;
          cropEncodingMs = rendered.cropEncodingMs;
          previewFallbackMs = rendered.fallbackMs;
          previewMaxScale = rendered.scale;
          previewPageRenderMs = rendered.pageRenderMs;
          previewPeakPixels = rendered.pixelCount;
          previewRenderingMs = Date.now() - previewStartedAt;
        } finally {
          releasePdfRender?.();
          releasePreview();
        }
      }
      const storageWaitStartedAt = Date.now();
      const releaseStorage = await this.storagePages.acquire(signal);
      storageStageWaitMs = Date.now() - storageWaitStartedAt;
      const storageStartedAt = Date.now();
      let annotationsCreated = 0;
      let annotationsRemoved = 0;
      let annotationsSkipped = 0;
      let stored: FigureResultStoreReconcile;
      try {
        stored = reusableResults
          ? {
              created: 0,
              removed: 0,
              results: reusableResults,
              skipped: candidates.length,
              timings: {
                imageWriteMs: 0,
                lockWaitMs: 0,
                manifestWriteMs: 0,
              },
            }
          : await this.resultStore.reconcilePage(
              reader._item,
              page.pageIndex,
              candidates,
              resultImages,
              duplicateMode,
              signal,
              sourceFingerprint,
            );
        storageMs = Date.now() - storageStartedAt;
      } finally {
        releaseStorage();
      }
      resultImages = [];
      if (syncAnnotations) {
        const annotationWaitStartedAt = Date.now();
        const releaseAnnotation = await this.annotationPages.acquire(signal);
        annotationStageWaitMs = Date.now() - annotationWaitStartedAt;
        const annotationStartedAt = Date.now();
        try {
          const reconciled = await reconcileGeneratedAnnotations(
            reader,
            page.pageIndex,
            candidates,
            duplicateMode,
            signal,
          );
          annotationsCreated = reconciled.created;
          annotationsRemoved = reconciled.removed;
          annotationsSkipped = reconciled.skipped;
        } finally {
          annotationMs = Date.now() - annotationStartedAt;
          releaseAnnotation();
        }
      }
      if (stored.timings) {
        imageWriteMs = stored.timings.imageWriteMs;
        lockWaitMs = stored.timings.lockWaitMs;
        manifestWriteMs = stored.timings.manifestWriteMs;
      }
      return {
        annotationMs,
        annotationStageWaitMs,
        annotationsCreated,
        annotationsRemoved,
        annotationsSkipped,
        cacheLookupMs,
        created: stored.created,
        cropEncodingMs,
        detectionMs,
        detectionRenderWaitMs,
        detectionStageWaitMs,
        failed: false,
        imageWriteMs,
        inferenceMs,
        lockWaitMs,
        manifestWriteMs,
        postprocessMs,
        preprocessMs,
        previewFallbackMs,
        previewMaxScale,
        previewPageRenderMs,
        previewPdfRenderWaitMs,
        previewPeakPixels,
        previewRenderingMs,
        previewStageWaitMs,
        removed: stored.removed,
        renderingMs,
        resultsCreated: stored.created,
        resultsRemoved: stored.removed,
        resultsSkipped: stored.skipped,
        skipped: stored.skipped,
        storageMs,
        storageStageWaitMs,
        workerDecodeMs,
        workerQueueMs,
        workerTotalMs,
      };
    } catch (error) {
      if (isCancellationError(error)) throw error;
      if (workerPool.isDisposed) throw error;
      ztoolkit.log(
        `Layout analysis failed on page ${page.pageIndex + 1}`,
        error,
      );
      return {
        annotationMs,
        annotationStageWaitMs,
        annotationsCreated: 0,
        annotationsRemoved: 0,
        annotationsSkipped: 0,
        cacheLookupMs,
        created: 0,
        cropEncodingMs,
        detectionMs: detectionMs ?? Date.now() - pageStartedAt,
        detectionRenderWaitMs,
        detectionStageWaitMs,
        failed: true,
        imageWriteMs,
        inferenceMs,
        lockWaitMs,
        manifestWriteMs,
        postprocessMs,
        preprocessMs,
        previewFallbackMs,
        previewMaxScale,
        previewPageRenderMs,
        previewPdfRenderWaitMs,
        previewPeakPixels,
        previewRenderingMs,
        previewStageWaitMs,
        removed: 0,
        renderingMs,
        resultsCreated: 0,
        resultsRemoved: 0,
        resultsSkipped: 0,
        skipped: 0,
        storageMs,
        storageStageWaitMs,
        workerDecodeMs,
        workerQueueMs,
        workerTotalMs,
      };
    }
  }

  private async renderResultImages(
    reader: PdfReader,
    candidates: readonly AnnotationCandidate[],
    page: Omit<PageLayoutData, "elements">,
    signal?: AbortSignal,
  ): Promise<{
    cropEncodingMs: number;
    fallbackMs: number;
    images: ArrayBuffer[];
    pageRenderMs: number;
    pixelCount: number;
    scale: number;
  }> {
    if (candidates.length === 0) {
      return {
        cropEncodingMs: 0,
        fallbackMs: 0,
        images: [],
        pageRenderMs: 0,
        pixelCount: 0,
        scale: 0,
      };
    }
    let cropEncodingMs = 0;
    let pageRenderMs = 0;
    let pixelCount = 0;
    let scale = 0;
    let images: Array<ArrayBuffer | undefined> = candidates.map(
      () => undefined,
    );
    try {
      const rendered = await renderPageImageCrops(
        reader,
        page.pageIndex,
        page.viewBox,
        candidates.map(({ rect }) => rect),
        signal,
      );
      images = rendered.images;
      cropEncodingMs = rendered.cropEncodingMs;
      pageRenderMs = rendered.pageRenderMs;
      pixelCount = rendered.pixelCount;
      scale = rendered.scale;
    } catch (error) {
      if (isCancellationError(error)) throw error;
      ztoolkit.log(
        "Falling back after the bounded high-resolution page renderer failed",
        error,
      );
    }

    const missingIndices = images.flatMap((image, index) =>
      image ? [] : [index],
    );
    let fallbackMs = 0;
    if (missingIndices.length > 0) {
      const fallbackStartedAt = Date.now();
      const fallbackPageImage = await renderPageImage(
        reader,
        page.pageIndex,
        page.viewBox,
      );
      const fallbackImages = await cropPageImage(
        fallbackPageImage,
        page.viewBox,
        missingIndices.map((index) => candidates[index].rect),
        signal,
      );
      for (let index = 0; index < missingIndices.length; index++) {
        images[missingIndices[index]] = fallbackImages[index];
      }
      fallbackMs = Date.now() - fallbackStartedAt;
    }
    throwIfAborted(signal);
    if (images.some((image) => !image)) {
      throw new Error("One or more figure previews could not be rendered");
    }
    return {
      cropEncodingMs,
      fallbackMs,
      images: images as ArrayBuffer[],
      pageRenderMs,
      pixelCount,
      scale,
    };
  }

  private getWorkerPool(
    modelPath: string,
    variant: ModelVariant,
  ): LayoutWorkerPool {
    const key = `${modelPath}:${variant.id}`;
    if (
      !this.workerPool ||
      this.workerPool.isDisposed ||
      this.workerPoolKey !== key
    ) {
      this.workerPool?.dispose();
      this.workerPool = createWorkerPool(variant, modelPath);
      this.workerPoolKey = key;
    }
    return this.workerPool;
  }
}

function logAnalysisCompletion(
  reader: PdfReader,
  summary: AnalysisSummary,
  syncAnnotations: boolean,
): void {
  try {
    ztoolkit.log(
      "Layout analysis completed",
      createAnalysisTimingLog(reader, summary, syncAnnotations),
    );
  } catch (error) {
    Zotero.logError(error instanceof Error ? error : new Error(String(error)));
  }
}

function createAnalysisTimingLog(
  reader: PdfReader,
  summary: AnalysisSummary,
  syncAnnotations: boolean,
) {
  const timings = summary.timings;
  return {
    attachment: {
      itemID: reader._item.id,
      key: reader._item.key,
      libraryID: reader._item.libraryID,
    },
    wallMs: roundMilliseconds(timings.totalMs),
    pages: {
      analyzed: summary.pagesAnalyzed,
      failed: summary.failedPages,
      skipped: summary.pagesSkipped,
      total: summary.totalPages,
    },
    results: {
      created: summary.resultsCreated,
      removed: summary.resultsRemoved,
      skipped: summary.resultsSkipped,
    },
    setupMs: {
      model: roundMilliseconds(timings.modelPreparationMs),
      sourceFingerprint: roundMilliseconds(timings.sourceFingerprintMs),
      worker: roundMilliseconds(timings.workerPreparationMs),
    },
    scanMs: {
      pdfPageData: roundMilliseconds(timings.pageDataMs),
    },
    screenshotMs: {
      detectionExport: roundMilliseconds(timings.renderingMs),
      pngCropEncode: roundMilliseconds(timings.cropEncodingMs),
      previewFallback: roundMilliseconds(timings.previewFallbackMs),
      previewPageRender: roundMilliseconds(timings.previewPageRenderMs),
      previewStageWall: roundMilliseconds(timings.previewRenderingMs),
    },
    parsingMs: {
      decode: roundMilliseconds(timings.workerDecodeMs),
      detectCallWall: roundMilliseconds(timings.detectionMs),
      inference: roundMilliseconds(timings.inferenceMs),
      postprocess: roundMilliseconds(timings.postprocessMs),
      preprocess: roundMilliseconds(timings.preprocessMs),
      workerQueue: roundMilliseconds(timings.workerQueueMs),
      workerTotal: roundMilliseconds(timings.workerTotalMs),
    },
    storageMs: {
      attachmentLockWait: roundMilliseconds(timings.lockWaitMs),
      cacheLookup: roundMilliseconds(timings.cacheLookupMs),
      imageWrite: roundMilliseconds(timings.imageWriteMs),
      manifestWrite: roundMilliseconds(timings.manifestWriteMs),
      stageWall: roundMilliseconds(timings.storageMs),
    },
    annotations: {
      created: summary.annotationsCreated,
      enabled: syncAnnotations,
      removed: summary.annotationsRemoved,
      skipped: summary.annotationsSkipped,
      stageWallMs: roundMilliseconds(timings.annotationMs),
    },
    waitsMs: {
      annotationStage: roundMilliseconds(timings.annotationStageWaitMs),
      detectionStage: roundMilliseconds(timings.detectionStageWaitMs),
      pdfForDetection: roundMilliseconds(timings.detectionRenderWaitMs),
      pdfForPreview: roundMilliseconds(timings.previewPdfRenderWaitMs),
      previewStage: roundMilliseconds(timings.previewStageWaitMs),
      storageStage: roundMilliseconds(timings.storageStageWaitMs),
    },
    preview: {
      maxScale: roundMetric(timings.previewMaxScale),
      peakPixels: Math.round(timings.previewPeakPixels),
    },
    responsiveness: {
      longTasks: timings.eventLoopLongTaskCount,
      maxLagMs: roundMilliseconds(timings.eventLoopLagMaxMs),
    },
    timingNote:
      "Stage values are cumulative across pages and can exceed wallMs when pages overlap.",
  };
}

function roundMilliseconds(value: number): number {
  return roundMetric(Math.max(0, value));
}

function roundMetric(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : 0;
}

function createWorkerPool(
  variant: ModelVariant,
  modelPath: string,
): LayoutWorkerPool {
  const resourceBaseURL = `chrome://${config.addonRef}/content/`;
  return new LayoutWorkerPool({
    createWorker: () =>
      new Worker(
        `chrome://${config.addonRef}/content/yolo-worker.js?v=${config.addonRef}`,
        { type: "module" },
      ),
    expectedModelHash: variant.sha256,
    expectedModelSize: variant.size,
    loadModelBytes: () => readModelBytes(modelPath),
    log: (...values) => ztoolkit.log(...values),
    modelURL: `${resourceBaseURL}${variant.embeddedPath}`,
    modelName: MODEL_NAME,
    quantized: variant.quantized,
    resourceBaseURL,
    wasmURL: `${resourceBaseURL}transformers/dist/ort-wasm-simd-threaded.jsep.wasm`,
    workerCount: LAYOUT_WORKER_COUNT,
  });
}

async function readModelBytes(path: string): Promise<ArrayBuffer> {
  const bytes = await IOUtils.read(path);
  if (
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength &&
    bytes.buffer instanceof ArrayBuffer
  ) {
    return bytes.buffer;
  }
  return bytes.slice().buffer;
}

interface PagePipelineWaiter {
  abort?: () => void;
  reject(error: Error): void;
  resolve(release: () => void): void;
  signal?: AbortSignal;
}

class PagePipelineLimiter {
  private activePages = 0;
  private readonly waiters: PagePipelineWaiter[] = [];

  constructor(private readonly maximum: number) {
    if (!Number.isInteger(maximum) || maximum < 1) {
      throw new Error("Page pipeline limit must be a positive integer");
    }
  }

  public acquire(signal?: AbortSignal): Promise<() => void> {
    throwIfAborted(signal);
    return new Promise<() => void>((resolve, reject) => {
      const waiter: PagePipelineWaiter = { reject, resolve, signal };
      waiter.abort = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        signal?.removeEventListener("abort", waiter.abort as () => void);
        reject(new OperationCancelledError());
      };
      signal?.addEventListener("abort", waiter.abort, { once: true });
      this.waiters.push(waiter);
      this.dispatch();
    });
  }

  private dispatch(): void {
    while (this.activePages < this.maximum && this.waiters.length > 0) {
      const waiter = this.waiters.shift() as PagePipelineWaiter;
      if (waiter.signal?.aborted) {
        waiter.abort?.();
        continue;
      }
      if (waiter.abort) {
        waiter.signal?.removeEventListener("abort", waiter.abort);
      }
      this.activePages++;
      let released = false;
      waiter.resolve(() => {
        if (released) return;
        released = true;
        this.activePages--;
        this.dispatch();
      });
    }
  }
}

function getDuplicateMode(): DuplicateMode {
  return getPref("duplicateMode") === "skip-existing"
    ? "skip-existing"
    : "replace-page";
}

function mergeOutcomes(
  summary: AnalysisSummary,
  outcomes: readonly PageOutcome[],
): void {
  for (const outcome of outcomes) {
    summary.timings.annotationMs += outcome.annotationMs;
    summary.timings.annotationStageWaitMs += outcome.annotationStageWaitMs;
    summary.timings.cacheLookupMs += outcome.cacheLookupMs;
    summary.resultsCreated += outcome.resultsCreated;
    summary.resultsRemoved += outcome.resultsRemoved;
    summary.resultsSkipped += outcome.resultsSkipped;
    summary.annotationsCreated += outcome.annotationsCreated;
    summary.annotationsRemoved += outcome.annotationsRemoved;
    summary.annotationsSkipped += outcome.annotationsSkipped;
    summary.timings.cropEncodingMs += outcome.cropEncodingMs;
    summary.timings.detectionMs += outcome.detectionMs;
    summary.timings.detectionRenderWaitMs += outcome.detectionRenderWaitMs;
    summary.timings.detectionStageWaitMs += outcome.detectionStageWaitMs;
    summary.timings.imageWriteMs += outcome.imageWriteMs;
    summary.timings.inferenceMs += outcome.inferenceMs;
    summary.timings.lockWaitMs += outcome.lockWaitMs;
    summary.timings.manifestWriteMs += outcome.manifestWriteMs;
    summary.timings.postprocessMs += outcome.postprocessMs;
    summary.timings.preprocessMs += outcome.preprocessMs;
    summary.timings.previewFallbackMs += outcome.previewFallbackMs;
    summary.timings.previewMaxScale = Math.max(
      summary.timings.previewMaxScale,
      outcome.previewMaxScale,
    );
    summary.timings.previewPageRenderMs += outcome.previewPageRenderMs;
    summary.timings.previewPdfRenderWaitMs += outcome.previewPdfRenderWaitMs;
    summary.timings.previewPeakPixels = Math.max(
      summary.timings.previewPeakPixels,
      outcome.previewPeakPixels,
    );
    summary.timings.previewRenderingMs += outcome.previewRenderingMs;
    summary.timings.previewStageWaitMs += outcome.previewStageWaitMs;
    summary.timings.renderingMs += outcome.renderingMs;
    summary.timings.storageMs += outcome.storageMs;
    summary.timings.storageStageWaitMs += outcome.storageStageWaitMs;
    summary.timings.workerDecodeMs += outcome.workerDecodeMs;
    summary.timings.workerQueueMs += outcome.workerQueueMs;
    summary.timings.workerTotalMs += outcome.workerTotalMs;
    if (outcome.failed) summary.failedPages++;
    else summary.pagesAnalyzed++;
  }
}

function reportDetectionProgress(
  report: (text: string, value: number) => void,
  completedPages: number,
  totalPages: number,
): void {
  report(
    getString("progress-detecting", {
      args: { current: completedPages, total: totalPages },
    }),
    100 *
      (SCAN_PROGRESS_WEIGHT +
        (completedPages / totalPages) * (1 - SCAN_PROGRESS_WEIGHT)),
  );
}

async function yieldToUI(signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  throwIfAborted(signal);
}

const EVENT_LOOP_SAMPLE_INTERVAL_MS = 50;

class EventLoopResponsivenessMonitor {
  private intervalID?: ReturnType<typeof setInterval>;
  private lastSampleAt = 0;
  private longTaskCount = 0;
  private maximumLagMs = 0;

  public start(): void {
    if (this.intervalID !== undefined) return;
    this.lastSampleAt = Date.now();
    this.intervalID = setInterval(() => {
      const now = Date.now();
      const lag = Math.max(
        0,
        now - this.lastSampleAt - EVENT_LOOP_SAMPLE_INTERVAL_MS,
      );
      this.lastSampleAt = now;
      this.maximumLagMs = Math.max(this.maximumLagMs, lag);
      if (lag >= EVENT_LOOP_SAMPLE_INTERVAL_MS) this.longTaskCount++;
    }, EVENT_LOOP_SAMPLE_INTERVAL_MS);
  }

  public stop(): { longTaskCount: number; maximumLagMs: number } {
    if (this.intervalID !== undefined) clearInterval(this.intervalID);
    this.intervalID = undefined;
    return {
      longTaskCount: this.longTaskCount,
      maximumLagMs: this.maximumLagMs,
    };
  }
}
