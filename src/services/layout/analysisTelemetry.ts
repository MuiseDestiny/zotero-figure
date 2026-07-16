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
  pdfPreparationMs: number;
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

interface OutcomeCounts {
  created: number;
  removed: number;
  skipped: number;
}

type PageTimingKey =
  | "annotationMs"
  | "annotationStageWaitMs"
  | "cacheLookupMs"
  | "cropEncodingMs"
  | "detectionMs"
  | "detectionRenderWaitMs"
  | "detectionStageWaitMs"
  | "imageWriteMs"
  | "inferenceMs"
  | "lockWaitMs"
  | "manifestWriteMs"
  | "postprocessMs"
  | "preprocessMs"
  | "previewFallbackMs"
  | "previewMaxScale"
  | "previewPageRenderMs"
  | "previewPdfRenderWaitMs"
  | "previewPeakPixels"
  | "previewRenderingMs"
  | "previewStageWaitMs"
  | "renderingMs"
  | "storageMs"
  | "storageStageWaitMs"
  | "workerDecodeMs"
  | "workerQueueMs"
  | "workerTotalMs";

export type PageAnalysisTimings = Pick<AnalysisTimings, PageTimingKey>;

export interface PageAnalysisOutcome {
  annotations: OutcomeCounts;
  failed: boolean;
  results: OutcomeCounts;
  timings: PageAnalysisTimings;
}

export interface AnalysisFinalizationOutcome {
  annotationsRemoved: number;
  resultsRemoved: number;
  timings: Pick<
    AnalysisTimings,
    | "annotationMs"
    | "annotationStageWaitMs"
    | "imageWriteMs"
    | "lockWaitMs"
    | "manifestWriteMs"
    | "storageMs"
    | "storageStageWaitMs"
  >;
}

type MutablePageTimings = Omit<PageAnalysisTimings, "detectionMs"> & {
  detectionMs?: number;
};

const SUMMED_PAGE_TIMINGS = [
  "annotationMs",
  "annotationStageWaitMs",
  "cacheLookupMs",
  "cropEncodingMs",
  "detectionMs",
  "detectionRenderWaitMs",
  "detectionStageWaitMs",
  "imageWriteMs",
  "inferenceMs",
  "lockWaitMs",
  "manifestWriteMs",
  "postprocessMs",
  "preprocessMs",
  "previewFallbackMs",
  "previewPageRenderMs",
  "previewPdfRenderWaitMs",
  "previewRenderingMs",
  "previewStageWaitMs",
  "renderingMs",
  "storageMs",
  "storageStageWaitMs",
  "workerDecodeMs",
  "workerQueueMs",
  "workerTotalMs",
] as const satisfies readonly PageTimingKey[];

const PEAK_PAGE_TIMINGS = [
  "previewMaxScale",
  "previewPeakPixels",
] as const satisfies readonly PageTimingKey[];

const ZERO_COUNTS: OutcomeCounts = { created: 0, removed: 0, skipped: 0 };
const EVENT_LOOP_SAMPLE_INTERVAL_MS = 50;

export class PageAnalysisTelemetry {
  public readonly timings: MutablePageTimings = createPageTimings();
  private readonly startedAt: number;

  constructor(private readonly now: () => number = Date.now) {
    this.startedAt = now();
  }

  public succeed(
    results: OutcomeCounts,
    annotations: OutcomeCounts,
  ): PageAnalysisOutcome {
    return {
      annotations: { ...annotations },
      failed: false,
      results: { ...results },
      timings: this.snapshotTimings(0),
    };
  }

  public fail(): PageAnalysisOutcome {
    return {
      annotations: { ...ZERO_COUNTS },
      failed: true,
      results: { ...ZERO_COUNTS },
      timings: this.snapshotTimings(this.now() - this.startedAt),
    };
  }

  private snapshotTimings(fallbackDetectionMs: number): PageAnalysisTimings {
    return {
      ...this.timings,
      detectionMs: this.timings.detectionMs ?? fallbackDetectionMs,
    };
  }
}

export class AnalysisTelemetry {
  public readonly summary: AnalysisSummary;
  private readonly responsiveness = new EventLoopResponsivenessMonitor();

  constructor(
    totalPages: number,
    private readonly startedAt: number,
    private readonly now: () => number = Date.now,
  ) {
    this.summary = createAnalysisSummary(totalPages);
  }

  public startResponsivenessMonitoring(): void {
    this.responsiveness.start();
  }

  public setTotalPages(totalPages: number): void {
    this.summary.totalPages = totalPages;
  }

  public recordSkippedPage(): void {
    this.summary.pagesSkipped++;
  }

  public mergePage(outcome: PageAnalysisOutcome): void {
    mergeCounts(this.summary, outcome);
    for (const key of SUMMED_PAGE_TIMINGS) {
      this.summary.timings[key] += outcome.timings[key];
    }
    for (const key of PEAK_PAGE_TIMINGS) {
      this.summary.timings[key] = Math.max(
        this.summary.timings[key],
        outcome.timings[key],
      );
    }
    if (outcome.failed) this.summary.failedPages++;
    else this.summary.pagesAnalyzed++;
  }

  public mergeFinalization(outcome: AnalysisFinalizationOutcome): void {
    this.summary.annotationsRemoved += outcome.annotationsRemoved;
    this.summary.resultsRemoved += outcome.resultsRemoved;
    for (const key of Object.keys(outcome.timings) as Array<
      keyof AnalysisFinalizationOutcome["timings"]
    >) {
      this.summary.timings[key] += outcome.timings[key];
    }
  }

  public finish(): void {
    const responsiveness = this.responsiveness.stop();
    this.summary.timings.eventLoopLagMaxMs = responsiveness.maximumLagMs;
    this.summary.timings.eventLoopLongTaskCount = responsiveness.longTaskCount;
    this.summary.timings.totalMs = this.now() - this.startedAt;
  }
}

export interface AnalysisAttachmentIdentity {
  itemID: number;
  key: string;
  libraryID: number;
}

export function createAnalysisTimingLog(
  attachment: AnalysisAttachmentIdentity,
  summary: AnalysisSummary,
  syncAnnotations: boolean,
) {
  const timings = summary.timings;
  return {
    attachment,
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
      pdfEngine: roundMilliseconds(timings.pdfPreparationMs),
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

function createAnalysisSummary(totalPages: number): AnalysisSummary {
  return {
    annotationsCreated: 0,
    annotationsRemoved: 0,
    annotationsSkipped: 0,
    failedPages: 0,
    pagesAnalyzed: 0,
    pagesSkipped: 0,
    resultsCreated: 0,
    resultsRemoved: 0,
    resultsSkipped: 0,
    timings: createAnalysisTimings(),
    totalPages,
  };
}

function createAnalysisTimings(): AnalysisTimings {
  return {
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
    pdfPreparationMs: 0,
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
}

function createPageTimings(): MutablePageTimings {
  const timings = createAnalysisTimings();
  return {
    annotationMs: timings.annotationMs,
    annotationStageWaitMs: timings.annotationStageWaitMs,
    cacheLookupMs: timings.cacheLookupMs,
    cropEncodingMs: timings.cropEncodingMs,
    detectionMs: undefined,
    detectionRenderWaitMs: timings.detectionRenderWaitMs,
    detectionStageWaitMs: timings.detectionStageWaitMs,
    imageWriteMs: timings.imageWriteMs,
    inferenceMs: timings.inferenceMs,
    lockWaitMs: timings.lockWaitMs,
    manifestWriteMs: timings.manifestWriteMs,
    postprocessMs: timings.postprocessMs,
    preprocessMs: timings.preprocessMs,
    previewFallbackMs: timings.previewFallbackMs,
    previewMaxScale: timings.previewMaxScale,
    previewPageRenderMs: timings.previewPageRenderMs,
    previewPdfRenderWaitMs: timings.previewPdfRenderWaitMs,
    previewPeakPixels: timings.previewPeakPixels,
    previewRenderingMs: timings.previewRenderingMs,
    previewStageWaitMs: timings.previewStageWaitMs,
    renderingMs: timings.renderingMs,
    storageMs: timings.storageMs,
    storageStageWaitMs: timings.storageStageWaitMs,
    workerDecodeMs: timings.workerDecodeMs,
    workerQueueMs: timings.workerQueueMs,
    workerTotalMs: timings.workerTotalMs,
  };
}

function mergeCounts(
  summary: AnalysisSummary,
  outcome: PageAnalysisOutcome,
): void {
  summary.resultsCreated += outcome.results.created;
  summary.resultsRemoved += outcome.results.removed;
  summary.resultsSkipped += outcome.results.skipped;
  summary.annotationsCreated += outcome.annotations.created;
  summary.annotationsRemoved += outcome.annotations.removed;
  summary.annotationsSkipped += outcome.annotations.skipped;
}

function roundMilliseconds(value: number): number {
  return roundMetric(Math.max(0, value));
}

function roundMetric(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : 0;
}

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
