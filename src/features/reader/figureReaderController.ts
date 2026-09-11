import type { ProgressWindowHelper } from "zotero-plugin-toolkit";
import { config } from "../../../package.json";
import {
  isFigureResultTag,
  type DuplicateMode,
} from "../../domain/figureResults";
import type { AnnotationCandidate, Rect } from "../../domain/layout";
import {
  removeGeneratedAnnotationForCandidate,
  updateGeneratedAnnotationCommentForCandidate,
  updateGeneratedAnnotationPositionForCandidate,
} from "../../platform/zotero/annotations";
import {
  copyReaderAnnotationImage,
  getReaderAnnotations,
  navigateToReaderAnnotation,
  readReaderAnnotationCacheImage,
  saveReaderAnnotationImage,
} from "../../platform/zotero/readerAnnotations";
import type { ReaderAnnotationData } from "../../platform/zotero/readerAnnotations";
import { getReaderImageCropDataURL } from "../../platform/zotero/readerImageRenderer";
import type { PdfReader } from "../../platform/zotero/reader";
import { FigureOutputService } from "../../services/figureOutputService";
import {
  FormulaLatexCoordinator,
  type FormulaLatexEditSnapshot,
  type FormulaLatexUpdate,
} from "../../services/formula/formulaLatexCoordinator";
import { FormulaLatexServiceError } from "../../services/formula/formulaLatexService";
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
  private readonly formulaLatex: FormulaLatexCoordinator;
  private readonly ownsFormulaLatex: boolean;
  private readonly unsubscribeFormulaLatex: () => void;
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

  private readonly annotationContextMenuHandler: _ZoteroTypes.Reader.EventHandler<"createAnnotationContextMenu"> =
    ({ append, params, reader }) => {
      if (reader.type !== "pdf" || !this.ownsReader(reader)) return;
      const pdfReader = reader as PdfReader;
      const attachmentID = pdfReader._item.id;
      const libraryID = pdfReader._item.libraryID;
      let annotations: ReaderAnnotationData[];
      try {
        // Snapshot Reader-owned objects before the native menu opens. Zotero
        // can recycle annotation proxies while tearing the menu down.
        annotations = getReaderAnnotations(pdfReader)
          .filter(
            (annotation) =>
              params.ids.includes(annotation.id) &&
              annotation.type === "image" &&
              isUsableAnnotationPosition(annotation.position),
          )
          .map(cloneReaderAnnotation);
      } catch (error) {
        Zotero.logError(toError(error));
        return;
      }
      if (annotations.length === 0) return;
      const run = () => {
        // Let Zotero finish closing its native context menu before opening a
        // progress window or touching the PDF/annotation stores.
        this.win.setTimeout(() => {
          if (!this.started) return;
          void this.addAnnotationsToResults(
            pdfReader,
            attachmentID,
            libraryID,
            annotations,
          );
        }, 100);
      };
      append({
        label: getString("reader-menu-add-to-figure"),
        onCommand: run,
      });
    };

  constructor(
    private readonly win: Window,
    dependencies?: {
      formulaLatex?: FormulaLatexCoordinator;
      layoutAnalyzer: LayoutAnalyzer;
      resultStore: FigureResultStore;
    },
  ) {
    this.resultStore = dependencies?.resultStore ?? new FigureResultStore();
    this.layoutAnalyzer =
      dependencies?.layoutAnalyzer ?? new LayoutAnalyzer(this.resultStore);
    this.formulaLatex =
      dependencies?.formulaLatex ??
      new FormulaLatexCoordinator(this.resultStore);
    this.ownsFormulaLatex = dependencies?.formulaLatex === undefined;
    this.unsubscribeFormulaLatex = this.formulaLatex.subscribe((update) =>
      this.handleFormulaLatexUpdate(update),
    );
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
    Zotero.Reader.registerEventListener(
      "createAnnotationContextMenu",
      this.annotationContextMenuHandler,
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
    Zotero.Reader.unregisterEventListener(
      "createAnnotationContextMenu",
      this.annotationContextMenuHandler,
    );
    for (const controller of this.activeAnalyses.values()) controller.abort();
    this.activeAnalyses.clear();
    this.unsubscribeFormulaLatex();
    if (this.ownsFormulaLatex) this.formulaLatex.dispose();
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
      this.formulaLatex.recognizeAttachment(reader._item);
      this.refreshSidebarControls(reader);
      this.reloadSidebarResults(reader);
    }
  }

  private cancelAnalysis(reader: PdfReader): void {
    this.activeAnalyses.get(reader)?.abort();
  }

  private async addAllToNote(
    reader: PdfReader,
    results: readonly StoredFigureResult[],
  ): Promise<void> {
    await this.createNoteFromResults(reader._item, results);
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

  private async addAnnotationsToResults(
    reader: PdfReader,
    attachmentID: number,
    libraryID: number,
    annotations: readonly ReaderAnnotationData[],
  ): Promise<void> {
    const prepared: Array<{
      annotation: ReaderAnnotationData;
      candidate: AnnotationCandidate;
    }> = [];
    for (const annotation of annotations) {
      const position = annotation.position;
      if (!isUsableAnnotationPosition(position)) continue;
      const comment = this.win.prompt(
        getString("prompt-figure-caption"),
        annotation.comment?.trim() ?? "",
      );
      // Cancelling the prompt cancels this annotation only. This is useful
      // when several annotations were selected and a caption needs review.
      if (comment === null) continue;
      prepared.push({
        annotation,
        candidate: {
          comment: comment.trim(),
          pageIndex: position.pageIndex,
          rect: position.rects[0],
          tag: getAnnotationResultTag(annotation),
        },
      });
    }
    if (prepared.length === 0) return;
    const popup = this.createProgress(getString("progress-add-to-results"));
    let created = 0;
    let skipped = 0;
    try {
      const attachment = Zotero.Items.get(attachmentID);
      if (!attachment || !attachment.isPDFAttachment()) {
        throw new Error("The PDF attachment is no longer available");
      }
      for (const { annotation, candidate } of prepared) {
        const rect = candidate.rect;
        const image =
          (await readReaderAnnotationCacheImage(libraryID, annotation.id)) ??
          decodeReaderAnnotationImage(annotation.image) ??
          (await this.layoutAnalyzer.renderAnnotationCrop(
            attachment,
            candidate.pageIndex,
            rect,
          ));
        const result = await this.resultStore.reconcilePage(
          attachment,
          candidate.pageIndex,
          [candidate],
          [image],
          "skip-existing",
        );
        created += result.created;
        skipped += result.skipped;
      }
      popup
        .changeLine({
          text: getString("progress-add-to-results-done", {
            args: { created, skipped },
          }),
          type: "success",
        })
        .startCloseTimer(2_000);
      this.reloadSidebarResults(reader);
    } catch (error) {
      popup.changeLine({ text: toError(error).message, type: "fail" });
      Zotero.logError(toError(error));
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
    try {
      await removeGeneratedAnnotationForCandidate(reader._item, result);
    } finally {
      this.reloadSidebarResults(reader);
    }
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
    signal: AbortSignal,
  ): Promise<{
    detectedRect: [number, number, number, number];
    imageURL: string;
    pageAspectRatio: number;
    rect: [number, number, number, number];
  }> {
    const preview = await this.layoutAnalyzer.createResultCorrectionPreview(
      reader._item,
      result,
      signal,
    );
    return {
      detectedRect: preview.detectedRect,
      imageURL: bytesToDataURL(new Uint8Array(preview.image), "image/png"),
      pageAspectRatio: preview.pageAspectRatio,
      rect: preview.rect,
    };
  }

  private async correctResultRegion(
    reader: PdfReader,
    result: StoredFigureResult,
    rect: [number, number, number, number],
    signal: AbortSignal,
  ): Promise<StoredFigureResult | undefined> {
    const popup = this.createProgress(getString("progress-correct-region"));
    try {
      const updated = await this.layoutAnalyzer.correctResultRegion(
        reader._item,
        result,
        rect,
        signal,
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
      this.formulaLatex.publish(reader._item, updated);
      return updated;
    } catch (error) {
      if (signal.aborted || isCancellationError(error)) {
        popup.close();
        throw error;
      }
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

  private async copyResultLatex(
    reader: PdfReader,
    result: StoredFigureResult,
  ): Promise<StoredFigureResult> {
    const updated = await this.recognizeResultLatex(reader, result);
    Zotero.Utilities.Internal.copyTextToClipboard(
      updated.latex ?? result.latex ?? "",
    );
    return updated;
  }

  private async rerecognizeResultLatex(
    reader: PdfReader,
    result: StoredFigureResult,
  ): Promise<StoredFigureResult> {
    return this.recognizeResultLatex(reader, result, true);
  }

  private async recognizeResultLatex(
    reader: PdfReader,
    result: StoredFigureResult,
    force = false,
  ): Promise<StoredFigureResult> {
    try {
      return await this.formulaLatex.recognize(reader._item, result, { force });
    } catch (error) {
      if (isCancellationError(error)) throw error;
      throw this.localizeFormulaLatexError(error);
    }
  }

  private async editResultLatex(
    reader: PdfReader,
    edit: FormulaLatexEditSnapshot,
    latex: string,
  ): Promise<StoredFigureResult | undefined> {
    return this.formulaLatex.update(reader._item, edit.result.id, latex, edit);
  }

  private async prepareResultLatexEdit(
    reader: PdfReader,
    result: StoredFigureResult,
  ): Promise<FormulaLatexEditSnapshot | undefined> {
    return this.formulaLatex.prepareEdit(reader._item, result.id);
  }

  private localizeFormulaLatexError(value: unknown): Error {
    if (!(value instanceof FormulaLatexServiceError)) {
      return new Error(getString("error-formula-api-failed"));
    }
    switch (value.code) {
      case "missing-key":
        return new Error(getString("error-formula-api-key-missing"));
      case "http":
        return new Error(
          getString("error-formula-api-http", {
            args: { status: value.status ?? "-" },
          }),
        );
      case "network":
        return new Error(getString("error-formula-api-network"));
      case "timeout":
        return new Error(getString("error-formula-api-timeout"));
      case "invalid-response":
        return new Error(getString("error-formula-api-response"));
    }
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
        onAddAllToNote: (results) => this.addAllToNote(reader, results),
        onAddToNote: (result) => this.addResultToNote(reader, result),
        onAnalyze: () => this.runAnalysis(reader),
        onCancelAnalysis: () => this.cancelAnalysis(reader),
        onCacheTranslations: (contextKey, updates) =>
          this.resultStore.saveTranslations(reader._item, contextKey, updates),
        onClear: () => this.clearResults(reader),
        onCopyImage: (result) => this.copyResultImage(reader, result),
        onCopyLatex: (result) => this.copyResultLatex(reader, result),
        onCorrectRegion: (result, rect, signal) =>
          this.correctResultRegion(reader, result, rect, signal),
        onEditComment: (result, comment) =>
          this.editResultComment(reader, result, comment),
        onEditLatex: (edit, latex) => this.editResultLatex(reader, edit, latex),
        onGoToPage: (result) => this.navigateToResult(reader, result),
        onRemove: (result) => this.removeResult(reader, result),
        onRerecognizeLatex: (result) =>
          this.rerecognizeResultLatex(reader, result),
        onResultsDisplayed: () =>
          this.formulaLatex.recognizeAttachment(reader._item),
        onPrepareCorrection: (result, signal) =>
          this.prepareResultCorrection(reader, result, signal),
        onPrepareLatexEdit: (result) =>
          this.prepareResultLatexEdit(reader, result),
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

  private handleFormulaLatexUpdate(update: FormulaLatexUpdate): void {
    for (const [reader, panel] of this.sidebarPanels) {
      if (
        reader._item.libraryID === update.libraryID &&
        reader._item.key === update.attachmentKey
      ) {
        panel.updateFormulaLatex(update.result);
      }
    }
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
    this.readerDocuments.set(reader, {
      document,
      handlePageHide,
    });
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
      void this.layoutAnalyzer.prewarm().catch((error) => {
        if (!isCancellationError(error)) Zotero.logError(toError(error));
      });
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

function isUsableAnnotationPosition(
  position: ReaderAnnotationData["position"],
): position is { pageIndex: number; rects: [Rect, ...Rect[]] } {
  if (
    !position ||
    !Number.isInteger(position.pageIndex) ||
    position.pageIndex < 0
  ) {
    return false;
  }
  const rect = position.rects?.[0];
  return (
    Array.isArray(rect) &&
    rect.length === 4 &&
    rect.every(Number.isFinite) &&
    rect[2] > rect[0] &&
    rect[3] > rect[1]
  );
}

function cloneReaderAnnotation(
  annotation: ReaderAnnotationData,
): ReaderAnnotationData {
  return {
    ...annotation,
    position: annotation.position
      ? {
          pageIndex: annotation.position.pageIndex,
          rects: annotation.position.rects?.map((rect) => [...rect]),
        }
      : undefined,
    tags: (annotation.tags ?? []).map((tag) => ({ ...tag })),
  };
}

function getAnnotationResultTag(annotation: ReaderAnnotationData): string {
  const existing = (annotation.tags ?? [])
    .map((tag) => tag.name ?? tag.tag ?? "")
    .find((tag) => isFigureResultTag(tag));
  return existing?.trim() || "Figure";
}

function decodeReaderAnnotationImage(
  value: string | undefined,
): ArrayBuffer | undefined {
  if (!value) return undefined;
  const separator = value.indexOf(",");
  if (separator < 0 || !/^data:image\/png;base64,/i.test(value)) {
    return undefined;
  }
  try {
    const binary = atob(value.slice(separator + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes.buffer;
  } catch {
    return undefined;
  }
}
