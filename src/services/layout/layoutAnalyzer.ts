import { config } from "../../../package.json";
import type { DuplicateMode } from "../../domain/figureResults";
import {
  buildAnnotationCandidates,
  pageMayContainFigures,
  type PageLayoutData,
  type Rect,
} from "../../domain/layout";
import {
  mapLayoutElementsToPdf,
  transformRect,
} from "../../domain/pdfCoordinates";
import {
  reconcileGeneratedAnnotations,
  type AnnotationTarget,
} from "../../platform/zotero/annotations";
import type { PdfReader } from "../../platform/zotero/reader";
import {
  isCancellationError,
  OperationCancelledError,
  throwIfAborted,
} from "../../utils/cancellation";
import { getString } from "../../utils/locale";
import { getPref } from "../../utils/prefs";
import { AsyncPermitPool } from "../concurrency/asyncPermitPool";
import { KeyedAsyncMutex } from "../concurrency/keyedAsyncMutex";
import { MODEL_NAME, type ModelVariant } from "../model/modelCatalog";
import { modelManager } from "../model/modelManager";
import { LayoutWorkerPool } from "./workerPool";
import { MuPdfEngine } from "../pdf/muPdfEngine";
import type {
  PdfAnalysisDocument,
  PdfAnalysisPageData,
  PdfEngine,
} from "../pdf/pdfEngine";
import {
  FigureResultStore,
  type FigureResultRenderCandidate,
  type FigureResultStorePrune,
  type FigureResultStoreReconcile,
  type StoredFigureResult,
} from "../results/figureResultStore";
import {
  AnalysisTelemetry,
  createAnalysisTimingLog,
  PageAnalysisTelemetry,
  type AnalysisFinalizationOutcome,
  type AnalysisSummary,
  type PageAnalysisOutcome,
} from "./analysisTelemetry";

export type { AnalysisSummary, AnalysisTimings } from "./analysisTelemetry";

export interface AnalysisProgress {
  update(text: string, progress: number): void;
}

export interface AnalysisOptions {
  annotationReader?: PdfReader;
  signal?: AbortSignal;
  syncAnnotations?: boolean;
}

export interface ResultCorrectionPreview {
  detectedRect: Rect;
  image: ArrayBuffer;
  pageAspectRatio: number;
  rect: Rect;
}

const LAYOUT_WORKER_COUNT = 2;
// Two single-threaded ONNX workers may each retain one 640 px image/tensor.
// MuPDF renders one direct region at a time (at most 8 MP) and never retains a
// full high-resolution page canvas. Keep these limits aligned with
// docs/PERFORMANCE.md.
const MAX_SCHEDULED_PAGES = 3;
const MAX_OPEN_PDF_DOCUMENTS = 2;
const MAX_DETECTION_PAGES = 2;
const MAX_PDF_RENDERS = 1;
const MAX_PREVIEW_PAGES = 1;
const MAX_STORAGE_PAGES = 1;
const MAX_ANNOTATION_PAGES = 1;
const NO_PAGE_TASK_ERROR = Symbol("no-page-task-error");
const SCAN_PROGRESS_WEIGHT = 0.2;
const attachmentAnalysisLeases = new KeyedAsyncMutex<string>();

export class LayoutAnalyzer {
  private disposed = false;
  private readonly lifecycleController = new AbortController();
  private readonly scheduledPages = new AsyncPermitPool(MAX_SCHEDULED_PAGES);
  private readonly openPdfDocuments = new AsyncPermitPool(
    MAX_OPEN_PDF_DOCUMENTS,
  );
  private readonly detectionPages = new AsyncPermitPool(MAX_DETECTION_PAGES);
  private readonly pdfRenders = new AsyncPermitPool(MAX_PDF_RENDERS);
  private readonly previewPages = new AsyncPermitPool(MAX_PREVIEW_PAGES);
  private readonly storagePages = new AsyncPermitPool(MAX_STORAGE_PAGES);
  private readonly annotationPages = new AsyncPermitPool(MAX_ANNOTATION_PAGES);
  private workerPool?: LayoutWorkerPool;
  private workerPoolKey?: string;

  constructor(
    private readonly resultStore = new FigureResultStore(),
    private readonly pdfEngine: PdfEngine = new MuPdfEngine(),
    private readonly layoutWorkerCount = LAYOUT_WORKER_COUNT,
  ) {}

  public async prewarm(): Promise<void> {
    throwIfAborted(this.lifecycleController.signal);
    const [validation] = await Promise.all([
      modelManager.ensureRecommendedModel({
        signal: this.lifecycleController.signal,
      }),
      this.pdfEngine.prepare(this.lifecycleController.signal),
    ]);
    throwIfAborted(this.lifecycleController.signal);
    if (validation.state !== "valid") return;
    await this.getWorkerPool(validation.path, validation.variant).prepare(
      this.lifecycleController.signal,
    );
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.lifecycleController.abort();
    this.workerPool?.dispose();
    this.workerPool = undefined;
    this.workerPoolKey = undefined;
    this.pdfEngine.dispose();
  }

  public async createResultCorrectionPreview(
    attachment: Zotero.Item,
    result: StoredFigureResult,
    signal?: AbortSignal,
  ): Promise<ResultCorrectionPreview> {
    if (this.disposed) throw new OperationCancelledError();
    const releaseDocument = await this.openPdfDocuments.acquire(signal);
    let document: PdfAnalysisDocument | undefined;
    try {
      document = await this.pdfEngine.open(attachment, signal);
      const page = await document.getPageData(result.pageIndex, signal);
      const releasePreview = await this.previewPages.acquire(signal);
      let releaseRender: (() => void) | undefined;
      try {
        releaseRender = await this.pdfRenders.acquire(signal);
        const rendered = await document.renderRegions(
          result.pageIndex,
          [page.viewBox],
          signal,
        );
        const image = rendered.images[0];
        if (!image?.byteLength) {
          throw new Error("Correction preview image was not rendered");
        }
        return {
          detectedRect: normalizePdfRectForPage(
            result.detectedRect ?? result.rect,
            page,
          ),
          image,
          pageAspectRatio: getPageAspectRatio(page.pageBounds),
          rect: normalizePdfRectForPage(result.rect, page),
        };
      } finally {
        releaseRender?.();
        releasePreview();
      }
    } finally {
      await document?.close();
      releaseDocument();
    }
  }

  /** Render an image-annotation crop through the bounded MuPDF pipeline. */
  public async renderAnnotationCrop(
    attachment: Zotero.Item,
    pageIndex: number,
    rect: Rect,
    signal?: AbortSignal,
  ): Promise<ArrayBuffer> {
    if (this.disposed) throw new OperationCancelledError();
    const releaseDocument = await this.openPdfDocuments.acquire(signal);
    let document: PdfAnalysisDocument | undefined;
    let releaseRender: (() => void) | undefined;
    try {
      document = await this.pdfEngine.open(attachment, signal);
      releaseRender = await this.pdfRenders.acquire(signal);
      const rendered = await document.renderRegions(pageIndex, [rect], signal);
      const image = rendered.images[0];
      if (!image?.byteLength) {
        throw new Error("Image annotation crop was not rendered");
      }
      return image;
    } finally {
      releaseRender?.();
      await document?.close();
      releaseDocument();
    }
  }

  public async correctResultRegion(
    attachment: Zotero.Item,
    result: StoredFigureResult,
    normalizedRect: Rect,
    signal?: AbortSignal,
  ): Promise<StoredFigureResult | undefined> {
    if (this.disposed) throw new OperationCancelledError();
    const releaseDocument = await this.openPdfDocuments.acquire(signal);
    let document: PdfAnalysisDocument | undefined;
    try {
      document = await this.pdfEngine.open(attachment, signal);
      const page = await document.getPageData(result.pageIndex, signal);
      const pdfRect = denormalizePageRect(normalizedRect, page);
      const releasePreview = await this.previewPages.acquire(signal);
      let releaseRender: (() => void) | undefined;
      let image: ArrayBuffer;
      try {
        releaseRender = await this.pdfRenders.acquire(signal);
        const rendered = await document.renderRegions(
          result.pageIndex,
          [pdfRect],
          signal,
        );
        image = rendered.images[0];
        if (!image) throw new Error("Corrected result image was not rendered");
      } finally {
        releaseRender?.();
        releasePreview();
      }
      return await this.resultStore.updateRegion(
        attachment,
        result.id,
        pdfRect,
        image,
        signal,
      );
    } finally {
      await document?.close();
      releaseDocument();
    }
  }

  public analyze(
    reader: PdfReader,
    progress: AnalysisProgress,
    options: AnalysisOptions = {},
  ): Promise<AnalysisSummary> {
    return this.analyzeAttachment(reader._item, progress, {
      ...options,
      annotationReader: options.annotationReader ?? reader,
    });
  }

  public async analyzeAttachment(
    attachment: Zotero.Item,
    progress: AnalysisProgress,
    options: AnalysisOptions = {},
  ): Promise<AnalysisSummary> {
    if (this.disposed) throw new OperationCancelledError();
    const releaseAnalysis = await attachmentAnalysisLeases.acquire(
      getAttachmentAnalysisKey(attachment),
      options.signal,
    );
    try {
      return await this.analyzeAttachmentWithLease(
        attachment,
        progress,
        options,
      );
    } catch (error) {
      if (options.signal?.aborted || isCancellationError(error)) {
        throw new OperationCancelledError();
      }
      throw error;
    } finally {
      releaseAnalysis();
    }
  }

  private async analyzeAttachmentWithLease(
    attachment: Zotero.Item,
    progress: AnalysisProgress,
    options: AnalysisOptions,
  ): Promise<AnalysisSummary> {
    const analysisStartedAt = Date.now();
    const telemetry = new AnalysisTelemetry(0, analysisStartedAt);
    const summary = telemetry.summary;
    const timings = summary.timings;
    const { signal } = options;
    const syncAnnotations = options.syncAnnotations === true;
    throwIfAborted(signal);
    const modelPreparation = measureAsync(() =>
      modelManager.ensureRecommendedModel({ signal }),
    );
    const pdfPreparation = measureAsync(() => this.pdfEngine.prepare(signal));
    const [modelResult, pdfResult] = await Promise.all([
      modelPreparation,
      pdfPreparation,
    ]);
    const validation = modelResult.value;
    timings.modelPreparationMs = modelResult.elapsedMs;
    timings.pdfPreparationMs = pdfResult.elapsedMs;
    throwIfAborted(signal);
    if (validation.state === "missing") {
      throw new Error(getString("error-model-file-unavailable"));
    }
    if (validation.state === "invalid") {
      throw new Error(getString("error-model-integrity"));
    }

    const duplicateMode = getDuplicateMode();
    const workerPool = this.getWorkerPool(validation.path, validation.variant);
    const [fingerprintResult, workerResult] = await Promise.all([
      measureAsync(() =>
        this.resultStore.getSourceFingerprint(attachment, signal),
      ),
      measureAsync(() => workerPool.prepare(signal)),
    ]);
    const sourceFingerprint = fingerprintResult.value;
    timings.sourceFingerprintMs = fingerprintResult.elapsedMs;
    timings.workerPreparationMs = workerResult.elapsedMs;
    const annotationTarget = syncAnnotations
      ? (options.annotationReader ?? attachment)
      : undefined;
    const releaseOpenDocument = await this.openPdfDocuments.acquire(signal);
    let documentResult: { elapsedMs: number; value: PdfAnalysisDocument };
    try {
      documentResult = await measureAsync(() =>
        this.pdfEngine.open(attachment, signal),
      );
    } catch (error) {
      releaseOpenDocument();
      throw error;
    }
    const pdfDocument = documentResult.value;
    const totalPages = pdfDocument.pageCount;
    telemetry.setTotalPages(totalPages);
    timings.pdfPreparationMs += documentResult.elapsedMs;

    const operationController = new AbortController();
    const abortOperation = () => operationController.abort();
    signal?.addEventListener("abort", abortOperation, { once: true });
    if (signal?.aborted) abortOperation();
    const operationSignal = operationController.signal;

    let completedPages = 0;
    let completed = false;
    let lastProgress = 0;
    const skippedPageIndices: number[] = [];
    let pageTaskError: unknown | typeof NO_PAGE_TASK_ERROR = NO_PAGE_TASK_ERROR;
    const pendingPageTasks = new Set<Promise<void>>();
    const report = (text: string, value: number) => {
      lastProgress = Math.max(lastProgress, Math.min(100, value));
      progress.update(text, lastProgress);
    };

    telemetry.startResponsivenessMonitoring();
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
          const page = await pdfDocument.getPageData(
            pageIndex,
            operationSignal,
          );
          timings.pageDataMs += Date.now() - pageDataStartedAt;
          throwIfAborted(operationSignal);
          if (!pageMayContainFigures(page.chars)) {
            telemetry.recordSkippedPage();
            skippedPageIndices.push(pageIndex);
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
              pageBounds: page.pageBounds,
              pageIndex,
              pageToPdf: page.pageToPdf,
              viewBox: page.viewBox,
              width: page.viewBox[2] - page.viewBox[0],
            };
            const pageTask = (async () => {
              try {
                const outcome = await this.processPage(
                  attachment,
                  pdfDocument,
                  workerPool,
                  pageData,
                  sourceFingerprint,
                  duplicateMode,
                  syncAnnotations,
                  annotationTarget,
                  operationSignal,
                );
                completedPages++;
                telemetry.mergePage(outcome);
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
        if (duplicateMode === "replace-page") {
          const finalized = await this.finalizeReplacePageAnalysis(
            attachment,
            totalPages,
            skippedPageIndices,
            syncAnnotations,
            annotationTarget,
            operationSignal,
          );
          telemetry.mergeFinalization(finalized);
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
      telemetry.finish();
      if (completed) {
        logAnalysisCompletion(attachment, summary, syncAnnotations);
      }
      try {
        await pdfDocument.close();
      } finally {
        releaseOpenDocument();
      }
    }
  }

  private async processPage(
    attachment: Zotero.Item,
    pdfDocument: PdfAnalysisDocument,
    workerPool: LayoutWorkerPool,
    page: Omit<PageLayoutData, "elements"> &
      Pick<PdfAnalysisPageData, "pageBounds" | "pageToPdf">,
    sourceFingerprint: string,
    duplicateMode: DuplicateMode,
    syncAnnotations: boolean,
    annotationTarget?: AnnotationTarget,
    signal?: AbortSignal,
  ): Promise<PageAnalysisOutcome> {
    const telemetry = new PageAnalysisTelemetry();
    const timings = telemetry.timings;
    try {
      const detectionWaitStartedAt = Date.now();
      const releaseDetection = await this.detectionPages.acquire(signal);
      timings.detectionStageWaitMs = Date.now() - detectionWaitStartedAt;
      let elements: PageLayoutData["elements"];
      try {
        const renderWaitStartedAt = Date.now();
        const releaseRender = await this.pdfRenders.acquire(signal);
        timings.detectionRenderWaitMs = Date.now() - renderWaitStartedAt;
        let image: ArrayBuffer;
        try {
          const rendered = await pdfDocument.renderDetectionImage(
            page.pageIndex,
            signal,
          );
          image = rendered.image;
          timings.renderingMs = rendered.renderMs + rendered.encodeMs;
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
        elements = mapLayoutElementsToPdf(detection.elements, page);
        timings.workerDecodeMs = detection.timings.decodeMs;
        timings.workerQueueMs = detection.timings.queueMs;
        timings.preprocessMs = detection.timings.preprocessMs;
        timings.inferenceMs = detection.timings.inferenceMs;
        timings.postprocessMs = detection.timings.postprocessMs;
        timings.workerTotalMs = detection.timings.totalMs;
        timings.detectionMs = Date.now() - detectionStartedAt;
      } finally {
        releaseDetection();
      }
      throwIfAborted(signal);
      const candidates = buildAnnotationCandidates({ ...page, elements });
      const cacheLookupStartedAt = Date.now();
      const reusableResults = await this.resultStore.getReusablePageResults(
        attachment,
        page.pageIndex,
        candidates,
        signal,
        sourceFingerprint,
      );
      timings.cacheLookupMs = Date.now() - cacheLookupStartedAt;
      let resultImages: ArrayBuffer[] = [];
      let renderCandidates: FigureResultRenderCandidate[] = [];
      if (!reusableResults) {
        renderCandidates = await this.resultStore.getPageRenderCandidates(
          attachment,
          page.pageIndex,
          candidates,
          signal,
        );
        const previewWaitStartedAt = Date.now();
        const releasePreview = await this.previewPages.acquire(signal);
        timings.previewStageWaitMs = Date.now() - previewWaitStartedAt;
        const previewStartedAt = Date.now();
        let releasePdfRender: (() => void) | undefined;
        try {
          const pdfRenderWaitStartedAt = Date.now();
          releasePdfRender = await this.pdfRenders.acquire(signal);
          timings.previewPdfRenderWaitMs = Date.now() - pdfRenderWaitStartedAt;
          const rendered = await this.renderResultImages(
            pdfDocument,
            renderCandidates.map(({ renderRect }) => renderRect),
            page,
            signal,
          );
          resultImages = rendered.images;
          timings.cropEncodingMs = rendered.cropEncodingMs;
          timings.previewFallbackMs = rendered.fallbackMs;
          timings.previewMaxScale = rendered.scale;
          timings.previewPageRenderMs = rendered.pageRenderMs;
          timings.previewPeakPixels = rendered.pixelCount;
          timings.previewRenderingMs = Date.now() - previewStartedAt;
        } finally {
          releasePdfRender?.();
          releasePreview();
        }
      }
      const storageWaitStartedAt = Date.now();
      const releaseStorage = await this.storagePages.acquire(signal);
      timings.storageStageWaitMs = Date.now() - storageWaitStartedAt;
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
          : await this.resultStore.reconcilePlannedPage(
              attachment,
              page.pageIndex,
              renderCandidates,
              resultImages,
              duplicateMode,
              signal,
              sourceFingerprint,
            );
        timings.storageMs = Date.now() - storageStartedAt;
      } finally {
        releaseStorage();
      }
      resultImages = [];
      if (syncAnnotations) {
        if (!annotationTarget) {
          throw new Error("Annotation mirroring requires a PDF attachment");
        }
        const annotationWaitStartedAt = Date.now();
        const releaseAnnotation = await this.annotationPages.acquire(signal);
        timings.annotationStageWaitMs = Date.now() - annotationWaitStartedAt;
        const annotationStartedAt = Date.now();
        try {
          const annotationCandidates = stored.results
            .filter((result) => result.pageIndex === page.pageIndex)
            .map((result) => ({
              comment: result.comment,
              pageIndex: result.pageIndex,
              rect: result.rect,
              tag: result.tag,
            }));
          const reconciled = await reconcileGeneratedAnnotations(
            annotationTarget,
            page.pageIndex,
            annotationCandidates,
            duplicateMode,
            signal,
          );
          annotationsCreated = reconciled.created;
          annotationsRemoved = reconciled.removed;
          annotationsSkipped = reconciled.skipped;
        } finally {
          timings.annotationMs = Date.now() - annotationStartedAt;
          releaseAnnotation();
        }
      }
      if (stored.timings) {
        timings.imageWriteMs = stored.timings.imageWriteMs;
        timings.lockWaitMs = stored.timings.lockWaitMs;
        timings.manifestWriteMs = stored.timings.manifestWriteMs;
      }
      return telemetry.succeed(
        {
          created: stored.created,
          removed: stored.removed,
          skipped: stored.skipped,
        },
        {
          created: annotationsCreated,
          removed: annotationsRemoved,
          skipped: annotationsSkipped,
        },
      );
    } catch (error) {
      if (isCancellationError(error)) throw error;
      if (workerPool.isDisposed) throw error;
      ztoolkit.log(
        `Layout analysis failed on page ${page.pageIndex + 1}`,
        error,
      );
      return telemetry.fail();
    }
  }

  private async finalizeReplacePageAnalysis(
    attachment: Zotero.Item,
    totalPages: number,
    skippedPageIndices: readonly number[],
    syncAnnotations: boolean,
    annotationTarget?: AnnotationTarget,
    signal?: AbortSignal,
  ): Promise<AnalysisFinalizationOutcome> {
    const storageWaitStartedAt = Date.now();
    const releaseStorage = await this.storagePages.acquire(signal);
    const storageStageWaitMs = Date.now() - storageWaitStartedAt;
    const storageStartedAt = Date.now();
    let pruned: FigureResultStorePrune;
    try {
      pruned = await this.resultStore.pruneAfterAnalysis(
        attachment,
        totalPages,
        skippedPageIndices,
        signal,
      );
    } finally {
      releaseStorage();
    }
    const storageMs = Date.now() - storageStartedAt;
    const pagesToClearAnnotations = [
      ...new Set([...skippedPageIndices, ...pruned.removedPageIndices]),
    ].sort((first, second) => first - second);
    let annotationMs = 0;
    let annotationStageWaitMs = 0;
    let annotationsRemoved = 0;
    if (syncAnnotations && pagesToClearAnnotations.length > 0) {
      if (!annotationTarget) {
        throw new Error("Annotation mirroring requires a PDF attachment");
      }
      const annotationWaitStartedAt = Date.now();
      const releaseAnnotation = await this.annotationPages.acquire(signal);
      annotationStageWaitMs = Date.now() - annotationWaitStartedAt;
      const annotationStartedAt = Date.now();
      try {
        for (const pageIndex of pagesToClearAnnotations) {
          const reconciled = await reconcileGeneratedAnnotations(
            annotationTarget,
            pageIndex,
            [],
            "replace-page",
            signal,
          );
          annotationsRemoved += reconciled.removed;
        }
      } finally {
        annotationMs = Date.now() - annotationStartedAt;
        releaseAnnotation();
      }
    }
    return {
      annotationsRemoved,
      resultsRemoved: pruned.removed,
      timings: {
        annotationMs,
        annotationStageWaitMs,
        imageWriteMs: pruned.timings.imageWriteMs,
        lockWaitMs: pruned.timings.lockWaitMs,
        manifestWriteMs: pruned.timings.manifestWriteMs,
        storageMs,
        storageStageWaitMs,
      },
    };
  }

  private async renderResultImages(
    pdfDocument: PdfAnalysisDocument,
    rects: readonly Rect[],
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
    if (rects.length === 0) {
      return {
        cropEncodingMs: 0,
        fallbackMs: 0,
        images: [],
        pageRenderMs: 0,
        pixelCount: 0,
        scale: 0,
      };
    }
    const rendered = await pdfDocument.renderRegions(
      page.pageIndex,
      rects,
      signal,
    );
    throwIfAborted(signal);
    if (rendered.images.length !== rects.length) {
      throw new Error("One or more figure previews could not be rendered");
    }
    return {
      cropEncodingMs: rendered.encodeMs,
      fallbackMs: 0,
      images: rendered.images,
      pageRenderMs: rendered.renderMs,
      pixelCount: rendered.pixelCount,
      scale: rendered.maxScale,
    };
  }

  private getWorkerPool(
    modelPath: string,
    variant: ModelVariant,
  ): LayoutWorkerPool {
    if (this.disposed) throw new OperationCancelledError();
    const key = `${modelPath}:${variant.id}`;
    if (
      !this.workerPool ||
      this.workerPool.isDisposed ||
      this.workerPoolKey !== key
    ) {
      this.workerPool?.dispose();
      this.workerPool = createWorkerPool(
        variant,
        modelPath,
        this.layoutWorkerCount,
      );
      this.workerPoolKey = key;
    }
    return this.workerPool;
  }
}

function getPageAspectRatio(pageBounds: Rect): number {
  const width = pageBounds[2] - pageBounds[0];
  const height = pageBounds[3] - pageBounds[1];
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error("Correction preview page has invalid dimensions");
  }
  return width / height;
}

function logAnalysisCompletion(
  attachment: Zotero.Item,
  summary: AnalysisSummary,
  syncAnnotations: boolean,
): void {
  try {
    ztoolkit.log(
      "Layout analysis completed",
      createAnalysisTimingLog(
        {
          itemID: attachment.id,
          key: attachment.key,
          libraryID: attachment.libraryID,
        },
        summary,
        syncAnnotations,
      ),
    );
  } catch (error) {
    Zotero.logError(error instanceof Error ? error : new Error(String(error)));
  }
}

async function measureAsync<T>(
  operation: () => Promise<T>,
): Promise<{ elapsedMs: number; value: T }> {
  const startedAt = Date.now();
  const value = await operation();
  return { elapsedMs: Date.now() - startedAt, value };
}

function createWorkerPool(
  variant: ModelVariant,
  modelPath: string,
  workerCount = LAYOUT_WORKER_COUNT,
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
    workerCount,
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

function getDuplicateMode(): DuplicateMode {
  return getPref("duplicateMode") === "skip-existing"
    ? "skip-existing"
    : "replace-page";
}

function getAttachmentAnalysisKey(attachment: Zotero.Item): string {
  return `${attachment.libraryID}:${attachment.key}`;
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

function normalizePdfRectForPage(rect: Rect, page: PdfAnalysisPageData): Rect {
  const pageRect = transformRect(rect, page.pdfToPage);
  const [pageLeft, pageTop, pageRight, pageBottom] = page.pageBounds;
  const width = pageRight - pageLeft;
  const height = pageBottom - pageTop;
  if (width <= 0 || height <= 0) throw new Error("Invalid PDF page bounds");
  return normalizeUnitRect([
    (pageRect[0] - pageLeft) / width,
    (pageRect[1] - pageTop) / height,
    (pageRect[2] - pageLeft) / width,
    (pageRect[3] - pageTop) / height,
  ]);
}

function denormalizePageRect(rect: Rect, page: PdfAnalysisPageData): Rect {
  const normalized = normalizeUnitRect(rect);
  const [pageLeft, pageTop, pageRight, pageBottom] = page.pageBounds;
  const width = pageRight - pageLeft;
  const height = pageBottom - pageTop;
  if (width <= 0 || height <= 0) throw new Error("Invalid PDF page bounds");
  return transformRect(
    [
      pageLeft + normalized[0] * width,
      pageTop + normalized[1] * height,
      pageLeft + normalized[2] * width,
      pageTop + normalized[3] * height,
    ],
    page.pageToPdf,
  ).map((coordinate) => Math.round(coordinate * 100) / 100) as Rect;
}

function normalizeUnitRect(value: Rect): Rect {
  const rect = value.map((coordinate) =>
    Math.max(0, Math.min(1, coordinate)),
  ) as Rect;
  if (rect[2] - rect[0] < 0.005 || rect[3] - rect[1] < 0.005) {
    throw new Error("Corrected result region is too small");
  }
  return rect;
}

async function yieldToUI(signal?: AbortSignal): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  throwIfAborted(signal);
}
