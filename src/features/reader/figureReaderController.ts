import type { ProgressWindowHelper } from "zotero-plugin-toolkit";
import { config } from "../../../package.json";
import type { DuplicateMode } from "../../domain/figureResults";
import {
  removeGeneratedAnnotationForCandidate,
  updateGeneratedAnnotationCommentForCandidate,
  updateGeneratedAnnotationPositionForCandidate,
} from "../../platform/zotero/annotations";
import {
  copyReaderAnnotationImage,
  navigateToReaderAnnotation,
  saveReaderAnnotationImage,
} from "../../platform/zotero/readerAnnotations";
import { getReaderImageCropDataURL } from "../../platform/zotero/readerImageRenderer";
import type { PdfReader } from "../../platform/zotero/reader";
import { FigureOutputService } from "../../services/figureOutputService";
import { LayoutAnalyzer } from "../../services/layout/layoutAnalyzer";
import {
  FigureResultStore,
  type StoredFigureResult,
} from "../../services/results/figureResultStore";
import { isCancellationError } from "../../utils/cancellation";
import { bytesToDataURL } from "../../utils/dataURL";
import { getString } from "../../utils/locale";
import { getPref } from "../../utils/prefs";
import { FigureSidebarPanel } from "./figureSidebarPanel";

interface ReaderDocumentRegistration {
  document: Document;
  handlePageHide(): void;
}

export class FigureReaderController {
  private readonly activeAnalyses = new Map<PdfReader, AbortController>();
  private hydrateTimeoutID?: number;
  private prewarmIdleID?: number;
  private prewarmScheduled = false;
  private prewarmTimeoutID?: number;
  private readonly resultStore: FigureResultStore;
  private readonly layoutAnalyzer: LayoutAnalyzer;
  private readonly outputService: FigureOutputService;
  private readonly ownsLayoutAnalyzer: boolean;
  private readonly readerDocuments = new Map<
    PdfReader,
    ReaderDocumentRegistration
  >();
  private readonly sidebarPanels = new Map<PdfReader, FigureSidebarPanel>();
  private started = false;

  private readonly renderReaderHandler: _ZoteroTypes.Reader.EventHandler<"renderToolbar"> =
    ({ doc, reader }) => {
      if (reader.type !== "pdf" || !this.ownsReader(reader)) return;
      this.registerReader(reader as PdfReader, doc);
    };

  constructor(
    private readonly win: Window,
    dependencies?: {
      layoutAnalyzer: LayoutAnalyzer;
      resultStore: FigureResultStore;
    },
  ) {
    this.resultStore = dependencies?.resultStore ?? new FigureResultStore();
    this.layoutAnalyzer =
      dependencies?.layoutAnalyzer ?? new LayoutAnalyzer(this.resultStore);
    this.outputService = new FigureOutputService(this.resultStore);
    this.ownsLayoutAnalyzer = dependencies === undefined;
  }

  public start(): void {
    if (this.started) return;
    this.started = true;
    Zotero.Reader.registerEventListener(
      "renderToolbar",
      this.renderReaderHandler,
      config.addonID,
    );
    this.hydrateExistingReaders();
  }

  public dispose(): void {
    if (!this.started) return;
    this.started = false;
    Zotero.Reader.unregisterEventListener(
      "renderToolbar",
      this.renderReaderHandler,
    );
    for (const controller of this.activeAnalyses.values()) controller.abort();
    this.activeAnalyses.clear();
    if (this.ownsLayoutAnalyzer) this.layoutAnalyzer.dispose();
    if (this.hydrateTimeoutID !== undefined) {
      this.win.clearTimeout(this.hydrateTimeoutID);
      this.hydrateTimeoutID = undefined;
    }
    if (this.prewarmIdleID !== undefined) {
      this.win.cancelIdleCallback(this.prewarmIdleID);
      this.prewarmIdleID = undefined;
    }
    if (this.prewarmTimeoutID !== undefined) {
      this.win.clearTimeout(this.prewarmTimeoutID);
      this.prewarmTimeoutID = undefined;
    }
    for (const registration of this.readerDocuments.values()) {
      registration.document.defaultView?.removeEventListener(
        "pagehide",
        registration.handlePageHide,
      );
    }
    this.readerDocuments.clear();
    for (const panel of this.sidebarPanels.values()) panel.dispose();
    this.sidebarPanels.clear();
  }

  private async runAnalysis(reader: PdfReader): Promise<void> {
    if (this.activeAnalyses.has(reader)) return;
    const controller = new this.win.AbortController();
    this.activeAnalyses.set(reader, controller);
    this.refreshSidebarControls(reader);
    const panel = this.sidebarPanels.get(reader);
    let latestProgress = 0;
    panel?.updateAnalysisProgress(
      getString("progress-initializing"),
      latestProgress,
    );
    const startedAt = Date.now();
    try {
      const summary = await this.layoutAnalyzer.analyzeAttachment(
        reader._item,
        {
          update: (text, progress) => {
            latestProgress = progress;
            panel?.updateAnalysisProgress(text, progress);
          },
        },
        {
          signal: controller.signal,
          annotationReader: reader,
          syncAnnotations: getPref("syncAnnotations") === true,
        },
      );
      panel?.updateAnalysisProgress(
        getString("progress-done", {
          args: {
            annotations: summary.annotationsCreated,
            count: summary.resultsCreated,
            removed: summary.resultsRemoved,
            seconds: Math.round((Date.now() - startedAt) / 1_000),
            skipped: summary.resultsSkipped,
          },
        }),
        100,
        "success",
        3_000,
      );
    } catch (error) {
      if (isCancellationError(error)) {
        panel?.updateAnalysisProgress(
          getString("progress-cancelled"),
          latestProgress,
          "cancelled",
          1_500,
        );
        return;
      }
      const resolvedError = toError(error);
      Zotero.logError(resolvedError);
      panel?.updateAnalysisProgress(
        getString("progress-error", {
          args: { message: resolvedError.message },
        }),
        latestProgress,
        "error",
      );
    } finally {
      this.activeAnalyses.delete(reader);
      this.refreshSidebarControls(reader);
      this.reloadSidebarResults(reader);
    }
  }

  private cancelAnalysis(reader: PdfReader): void {
    this.activeAnalyses.get(reader)?.abort();
  }

  private async addAllToNote(reader: PdfReader): Promise<void> {
    await this.createNoteFromResults(
      reader._item,
      await this.resultStore.list(reader._item),
    );
  }

  private async addResultToNote(
    reader: PdfReader,
    result: StoredFigureResult,
  ): Promise<void> {
    await this.createNoteFromResults(reader._item, [result]);
  }

  private async syncResultsToAnnotations(reader: PdfReader): Promise<void> {
    const popup = this.createProgress(getString("progress-sync-annotations"));
    const mode: DuplicateMode =
      getPref("duplicateMode") === "skip-existing"
        ? "skip-existing"
        : "replace-page";
    try {
      const { created, removed, skipped } =
        await this.outputService.syncStoredResultsToAnnotations(
          reader._item,
          mode,
        );
      popup
        .changeLine({
          text: getString("progress-sync-annotations-done", {
            args: { created, removed, skipped },
          }),
          type: "success",
        })
        .startCloseTimer(2_000);
    } catch (error) {
      popup.changeLine({ text: toError(error).message, type: "fail" });
      throw error;
    }
  }

  private async createNoteFromResults(
    attachment: Zotero.Item,
    results: readonly StoredFigureResult[],
  ): Promise<void> {
    if (results.length === 0) return;
    const popup = this.createProgress(getString("progress-add-note"));
    try {
      await this.outputService.createNoteFromResults(attachment, results);
      popup.changeLine({ type: "success" }).startCloseTimer(1_000);
    } catch (error) {
      const resolvedError = toError(error);
      popup.changeLine({ text: resolvedError.message, type: "fail" });
      throw error;
    }
  }

  private async clearResults(reader: PdfReader): Promise<void> {
    await this.resultStore.clear(reader._item);
  }

  private async removeResult(
    reader: PdfReader,
    result: StoredFigureResult,
  ): Promise<void> {
    if (!this.win.confirm(getString("confirm-remove-one"))) return;
    await this.resultStore.remove(reader._item, result.id);
    await removeGeneratedAnnotationForCandidate(reader._item, result);
    this.reloadSidebarResults(reader);
  }

  private async editResultComment(
    reader: PdfReader,
    result: StoredFigureResult,
    comment: string,
  ): Promise<StoredFigureResult | undefined> {
    const updated = await this.resultStore.updateComment(
      reader._item,
      result.id,
      comment,
    );
    if (!updated) return undefined;
    try {
      await updateGeneratedAnnotationCommentForCandidate(reader._item, updated);
    } catch (error) {
      Zotero.logError(toError(error));
    }
    return updated;
  }

  private async prepareResultCorrection(
    reader: PdfReader,
    result: StoredFigureResult,
  ): Promise<{
    detectedRect: [number, number, number, number];
    imageURL: string;
    rect: [number, number, number, number];
  }> {
    const preview = await this.layoutAnalyzer.createResultCorrectionPreview(
      reader._item,
      result,
    );
    return {
      detectedRect: preview.detectedRect,
      imageURL: bytesToDataURL(new Uint8Array(preview.image), "image/jpeg"),
      rect: preview.rect,
    };
  }

  private async correctResultRegion(
    reader: PdfReader,
    result: StoredFigureResult,
    rect: [number, number, number, number],
  ): Promise<StoredFigureResult | undefined> {
    const popup = this.createProgress(getString("progress-correct-region"));
    try {
      const updated = await this.layoutAnalyzer.correctResultRegion(
        reader._item,
        result,
        rect,
      );
      if (!updated) {
        popup.close();
        return undefined;
      }
      try {
        await updateGeneratedAnnotationPositionForCandidate(
          reader._item,
          result,
          updated,
        );
      } catch (error) {
        Zotero.logError(toError(error));
      }
      popup
        .changeLine({
          text: getString("progress-correct-region-done"),
          type: "success",
        })
        .startCloseTimer(1_000);
      return updated;
    } catch (error) {
      popup.changeLine({ text: toError(error).message, type: "fail" });
      throw error;
    }
  }

  private async copyResultImage(
    reader: PdfReader,
    result: StoredFigureResult,
  ): Promise<void> {
    const image = await getReaderImageCropDataURL(
      reader,
      result,
      result.imagePath,
    );
    await copyReaderAnnotationImage(reader, image);
  }

  private async saveResultImage(
    reader: PdfReader,
    result: StoredFigureResult,
  ): Promise<void> {
    const image = await getReaderImageCropDataURL(
      reader,
      result,
      result.imagePath,
    );
    await saveReaderAnnotationImage(reader, image);
  }

  private async navigateToResult(
    reader: PdfReader,
    result: StoredFigureResult,
  ): Promise<void> {
    await navigateToReaderAnnotation(reader, {
      id: result.id,
      position: { pageIndex: result.pageIndex, rects: [result.rect] },
      tags: [],
      type: "image",
    });
  }

  private createProgress(text: string): ProgressWindowHelper {
    return new ztoolkit.ProgressWindow(config.addonName, {
      closeOtherProgressWindows: true,
      closeTime: -1,
      window: this.win,
    })
      .createLine({ text, type: "default" })
      .show();
  }

  private refreshSidebarControls(reader: PdfReader): void {
    this.sidebarPanels.get(reader)?.refreshControls();
  }

  private reloadSidebarResults(reader: PdfReader): void {
    this.sidebarPanels.get(reader)?.reloadResults();
  }

  private registerReader(reader: PdfReader, doc: Document): void {
    this.registerReaderDocument(reader, doc);
    let panel = this.sidebarPanels.get(reader);
    if (!panel) {
      panel = new FigureSidebarPanel({
        getCachedTranslations: (contextKey) =>
          this.resultStore.getCachedTranslations(reader._item, contextKey),
        getResults: () => this.resultStore.list(reader._item),
        isAnalyzing: () => this.activeAnalyses.has(reader),
        onAddAllToNote: () => this.addAllToNote(reader),
        onAddToNote: (result) => this.addResultToNote(reader, result),
        onAnalyze: () => this.runAnalysis(reader),
        onCancelAnalysis: () => this.cancelAnalysis(reader),
        onCacheTranslations: (contextKey, updates) =>
          this.resultStore.saveTranslations(reader._item, contextKey, updates),
        onClear: () => this.clearResults(reader),
        onCopyImage: (result) => this.copyResultImage(reader, result),
        onCorrectRegion: (result, rect) =>
          this.correctResultRegion(reader, result, rect),
        onEditComment: (result, comment) =>
          this.editResultComment(reader, result, comment),
        onGoToPage: (result) => this.navigateToResult(reader, result),
        onRemove: (result) => this.removeResult(reader, result),
        onPrepareCorrection: (result) =>
          this.prepareResultCorrection(reader, result),
        onSaveImage: (result) => this.saveResultImage(reader, result),
        onSyncAnnotations: () => this.syncResultsToAnnotations(reader),
        ownerWindow: this.win,
        reader,
      });
      this.sidebarPanels.set(reader, panel);
    }
    panel.attach(doc);
    this.schedulePrewarm();
  }

  private registerReaderDocument(reader: PdfReader, document: Document): void {
    const current = this.readerDocuments.get(reader);
    if (current?.document === document) return;
    current?.document.defaultView?.removeEventListener(
      "pagehide",
      current.handlePageHide,
    );
    const handlePageHide = () => {
      const registered = this.readerDocuments.get(reader);
      if (registered?.document !== document) return;
      this.readerDocuments.delete(reader);
      this.activeAnalyses.get(reader)?.abort();
      const panel = this.sidebarPanels.get(reader);
      if (panel) {
        this.sidebarPanels.delete(reader);
        panel.dispose();
      }
    };
    this.readerDocuments.set(reader, { document, handlePageHide });
    document.defaultView?.addEventListener("pagehide", handlePageHide, {
      once: true,
    });
  }

  private hydrateExistingReaders(attempt = 0): void {
    this.hydrateTimeoutID = undefined;
    if (!this.started) return;
    let pending = false;
    for (const reader of Zotero.Reader._readers) {
      if (reader.type !== "pdf" || !this.ownsReader(reader)) continue;
      const doc = (reader as PdfReader)._iframeWindow?.document;
      if (!doc?.querySelector("#reader-ui")) {
        pending = true;
        continue;
      }
      this.registerReader(reader as PdfReader, doc);
    }
    if (pending && attempt < 20) {
      this.hydrateTimeoutID = this.win.setTimeout(
        () => this.hydrateExistingReaders(attempt + 1),
        250,
      );
    }
  }

  private schedulePrewarm(): void {
    if (this.prewarmScheduled) return;
    this.prewarmScheduled = true;
    const run = () => {
      this.prewarmIdleID = undefined;
      this.prewarmTimeoutID = undefined;
      if (!this.started) return;
      void this.layoutAnalyzer
        .prewarm()
        .catch((error) => Zotero.logError(toError(error)));
    };
    if (typeof this.win.requestIdleCallback === "function") {
      this.prewarmIdleID = this.win.requestIdleCallback(run, {
        timeout: 5_000,
      });
    } else {
      this.prewarmTimeoutID = this.win.setTimeout(run, 1_500);
    }
  }

  private ownsReader(reader: _ZoteroTypes.ReaderInstance): boolean {
    return !reader._window || reader._window === this.win;
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
