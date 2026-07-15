import type { ProgressWindowHelper } from "zotero-plugin-toolkit";
import { config } from "../../../package.json";
import type { AnnotationCandidate } from "../../domain/layout";
import {
  reconcileGeneratedAnnotations,
  removeGeneratedAnnotationForCandidate,
  type DuplicateMode,
} from "../../platform/zotero/annotations";
import {
  copyReaderAnnotationImage,
  navigateToReaderAnnotation,
  saveReaderAnnotationImage,
} from "../../platform/zotero/readerAnnotations";
import { getReaderImageCropDataURL } from "../../platform/zotero/readerImageRenderer";
import { encodeNoteImageNavigation } from "../../platform/zotero/noteNavigation";
import { getPdfReader, type PdfReader } from "../../platform/zotero/reader";
import { LayoutAnalyzer } from "../../services/layout/layoutAnalyzer";
import {
  FigureResultStore,
  type StoredFigureResult,
} from "../../services/results/figureResultStore";
import { isCancellationError } from "../../utils/cancellation";
import { getString } from "../../utils/locale";
import { getPref } from "../../utils/prefs";
import { FigureSidebarPanel } from "./figureSidebarPanel";

export class FigureReaderController {
  private readonly activeAnalyses = new Map<PdfReader, AbortController>();
  private hydrateTimeoutID?: number;
  private prewarmIdleID?: number;
  private prewarmScheduled = false;
  private prewarmTimeoutID?: number;
  private readonly resultStore: FigureResultStore;
  private readonly layoutAnalyzer: LayoutAnalyzer;
  private readonly ownsLayoutAnalyzer: boolean;
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
    for (const panel of this.sidebarPanels.values()) panel.dispose();
    this.sidebarPanels.clear();
  }

  private async runAnalysis(reader: PdfReader): Promise<void> {
    if (this.activeAnalyses.has(reader)) return;
    const controller = new this.win.AbortController();
    this.activeAnalyses.set(reader, controller);
    this.refreshSidebarControls(reader);
    const popup = this.createProgress(getString("progress-initializing"));
    const startedAt = Date.now();
    try {
      const pdfReader = await getPdfReader(reader._item.id);
      const summary = await this.layoutAnalyzer.analyze(
        pdfReader,
        {
          update: (text, progress) => popup.changeLine({ progress, text }),
        },
        {
          signal: controller.signal,
          syncAnnotations: getPref("syncAnnotations") === true,
        },
      );
      popup
        .changeLine({
          progress: 100,
          text: getString("progress-done", {
            args: {
              annotations: summary.annotationsCreated,
              count: summary.resultsCreated,
              removed: summary.resultsRemoved,
              seconds: Math.round((Date.now() - startedAt) / 1_000),
              skipped: summary.resultsSkipped,
            },
          }),
          type: "success",
        })
        .startCloseTimer(3_000);
    } catch (error) {
      if (isCancellationError(error)) {
        popup
          .changeLine({
            text: getString("progress-cancelled"),
            type: "default",
          })
          .startCloseTimer(1_500);
        return;
      }
      const resolvedError = toError(error);
      Zotero.logError(resolvedError);
      popup.changeLine({
        text: getString("progress-error", {
          args: { message: resolvedError.message },
        }),
        type: "fail",
      });
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
    const results = await this.resultStore.list(reader._item);
    if (results.length === 0) return;
    const popup = this.createProgress(getString("progress-sync-annotations"));
    const candidatesByPage = new Map<number, AnnotationCandidate[]>();
    for (const result of results) {
      const candidates = candidatesByPage.get(result.pageIndex) ?? [];
      candidates.push({
        comment: result.comment,
        pageIndex: result.pageIndex,
        rect: result.rect,
        tag: result.tag,
      });
      candidatesByPage.set(result.pageIndex, candidates);
    }
    const mode: DuplicateMode =
      getPref("duplicateMode") === "skip-existing"
        ? "skip-existing"
        : "replace-page";
    let created = 0;
    let removed = 0;
    let skipped = 0;
    try {
      for (const [pageIndex, candidates] of [...candidatesByPage].sort(
        ([first], [second]) => first - second,
      )) {
        const reconciled = await reconcileGeneratedAnnotations(
          reader,
          pageIndex,
          candidates,
          mode,
        );
        created += reconciled.created;
        removed += reconciled.removed;
        skipped += reconciled.skipped;
      }
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
    let note: Zotero.Item | undefined;
    let noteSaved = false;
    try {
      note = new Zotero.Item("note");
      note.libraryID = attachment.libraryID;
      if (attachment.parentID) note.parentID = attachment.parentID;
      await note.saveTx({ skipSelect: true });
      const html: string[] = [
        '<div class="zotero-figure-note" data-citation-items="%5B%5D" data-schema-version="9">',
        `<h2>${escapeHTML(getString("note-title"))}</h2>`,
      ];
      const attachmentURI = String(Zotero.URI.getItemURI(attachment));
      for (const result of results) {
        const bytes = await IOUtils.read(result.imagePath);
        const image = await Zotero.Attachments.importEmbeddedImage({
          blob: new Blob([bytes], { type: "image/png" }),
          parentItemID: note.id,
          saveOptions: { skipSelect: true },
        });
        html.push(
          `<p><strong>${escapeHTML(result.tag)}</strong> · ${escapeHTML(
            getString("sidebar-page", { args: { page: result.pageLabel } }),
          )}</p>`,
          `<img data-attachment-key="${image.key}" data-annotation="${encodeNoteImageNavigation(
            attachmentURI,
            result,
          )}" alt="${escapeHTML(result.comment)}" />`,
          result.comment ? `<p>${escapeHTML(result.comment)}</p>` : "",
        );
      }
      html.push("</div>");
      note.setNote(html.join(""));
      await note.saveTx({ skipSelect: true });
      noteSaved = true;
      popup.changeLine({ type: "success" }).startCloseTimer(1_000);
    } catch (error) {
      const resolvedError = toError(error);
      if (note?.id && !noteSaved) {
        try {
          await note.eraseTx();
        } catch (cleanupError) {
          Zotero.logError(toError(cleanupError));
        }
      }
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
        onGoToPage: (result) => this.navigateToResult(reader, result),
        onRemove: (result) => this.removeResult(reader, result),
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

function escapeHTML(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
