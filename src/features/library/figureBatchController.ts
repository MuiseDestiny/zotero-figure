import type { ProgressWindowHelper } from "zotero-plugin-toolkit";
import { config } from "../../../package.json";
import { FigureOutputService } from "../../services/figureOutputService";
import { getImageAnnotationCandidate } from "../../platform/zotero/annotations";
import { readReaderAnnotationCacheImage } from "../../platform/zotero/readerAnnotations";
import { FormulaLatexCoordinator } from "../../services/formula/formulaLatexCoordinator";
import {
  type AnalysisProgress,
  LayoutAnalyzer,
} from "../../services/layout/layoutAnalyzer";
import { FigureResultStore } from "../../services/results/figureResultStore";
import {
  isCancellationError,
  OperationCancelledError,
  throwIfAborted,
} from "../../utils/cancellation";
import { getString } from "../../utils/locale";

type BatchAction = "analyze" | "annotations" | "note" | "import-annotations";

interface BatchTotals {
  annotations: number;
  failed: number;
  notes: number;
  results: number;
  succeeded: number;
}

const MENU_ID = `${config.addonRef}-item-menu`;
const ANNOTATION_MENU_ID = `${config.addonRef}-annotation-menu`;
const MENU_ICON = `chrome://${config.addonRef}/content/icons/favicon.png`;

export class FigureBatchController {
  private activePopup?: ProgressWindowHelper;
  private readonly outputService: FigureOutputService;
  private running = false;
  private runController?: AbortController;
  private started = false;

  constructor(
    private readonly layoutAnalyzer: LayoutAnalyzer,
    private readonly resultStore: FigureResultStore,
    private readonly formulaLatex: FormulaLatexCoordinator,
  ) {
    this.outputService = new FigureOutputService(resultStore);
  }

  public start(): void {
    if (this.started) return;
    this.started = true;
    ztoolkit.Menu.register("item", {
      children: [
        this.createMenuItem("batch-menu-analyze", "analyze"),
        this.createMenuItem("batch-menu-analyze-note", "note"),
        this.createMenuItem("batch-menu-analyze-annotations", "annotations"),
      ],
      icon: MENU_ICON,
      id: MENU_ID,
      isHidden: () => !hasSupportedSelection(),
      label: "PDF Figure",
      tag: "menu",
    });
    ztoolkit.Menu.register("item", {
      ...this.createMenuItem("reader-menu-add-to-figure", "import-annotations"),
      icon: MENU_ICON,
      id: ANNOTATION_MENU_ID,
      isHidden: () => !hasImageAnnotationSelection(),
      tag: "menuitem",
    });
  }

  public dispose(): void {
    this.runController?.abort();
    if (!this.started) return;
    this.started = false;
    ztoolkit.Menu.unregister(MENU_ID);
    ztoolkit.Menu.unregister(ANNOTATION_MENU_ID);
  }

  private createMenuItem(labelKey: string, action: BatchAction) {
    return {
      commandListener: () => {
        // Avoid mutating Zotero's native popup while its command is closing.
        const win = Zotero.getMainWindow();
        win.setTimeout(() => void this.run(action), 100);
      },
      label: getString(labelKey),
      tag: "menuitem" as const,
    };
  }

  private async run(action: BatchAction): Promise<void> {
    if (!this.started) return;
    if (this.running) {
      this.activePopup?.changeLine({
        text: getString("batch-progress-already-running"),
      });
      return;
    }
    this.running = true;
    const controller = new AbortController();
    this.runController = controller;
    const popup = this.createProgress();
    this.activePopup = popup;
    try {
      const selectedItems = getSelectedItems();
      if (action === "import-annotations") {
        await this.importAnnotations(selectedItems, popup, controller.signal);
        return;
      }
      const attachments = await resolvePdfAttachments(selectedItems);
      throwIfAborted(controller.signal);
      if (attachments.length === 0) {
        popup
          .changeLine({
            progress: 100,
            text: getString("batch-progress-no-pdf"),
            type: "fail",
          })
          .startCloseTimer(3_000);
        return;
      }

      const totals: BatchTotals = {
        annotations: 0,
        failed: 0,
        notes: 0,
        results: 0,
        succeeded: 0,
      };
      for (let index = 0; index < attachments.length; index++) {
        throwIfAborted(controller.signal);
        const attachment = attachments[index];
        const title = getAttachmentTitle(attachment);
        const progress = this.createAttachmentProgress(
          popup,
          index,
          attachments.length,
          title,
        );
        try {
          const summary = await this.layoutAnalyzer.analyzeAttachment(
            attachment,
            progress,
            {
              signal: controller.signal,
              syncAnnotations: action === "annotations",
            },
          );
          throwIfAborted(controller.signal);
          const results = await this.resultStore.list(attachment);
          throwIfAborted(controller.signal);
          this.formulaLatex.recognizeAttachment(attachment);
          totals.results += results.length;
          totals.annotations += summary.annotationsCreated;
          if (
            action === "note" &&
            (await this.outputService.createNoteFromResults(
              attachment,
              results,
            ))
          ) {
            totals.notes++;
          }
          throwIfAborted(controller.signal);
          totals.succeeded++;
        } catch (error) {
          if (controller.signal.aborted || isCancellationError(error)) {
            throw new OperationCancelledError();
          }
          totals.failed++;
          ztoolkit.log("Batch layout analysis failed", {
            attachmentID: attachment.id,
            error: toError(error),
          });
        }
        popup.changeLine({
          progress: Math.round(((index + 1) / attachments.length) * 100),
          text: getString("batch-progress-finished-item", {
            args: { current: index + 1, total: attachments.length },
          }),
        });
      }

      popup
        .changeLine({
          progress: 100,
          text: getString("batch-progress-done", {
            args: { ...totals },
          }),
          type: totals.failed === attachments.length ? "fail" : "success",
        })
        .startCloseTimer(totals.failed > 0 ? 5_000 : 3_000);
    } catch (error) {
      if (isCancellationError(error)) {
        if (this.started) {
          popup.changeLine({
            text: getString("progress-cancelled"),
            type: "default",
          });
        }
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
      if (this.runController === controller) this.runController = undefined;
      if (this.activePopup === popup) this.activePopup = undefined;
      this.running = false;
    }
  }

  private async importAnnotations(
    selectedItems: readonly Zotero.Item[],
    popup: ProgressWindowHelper,
    signal: AbortSignal,
  ): Promise<void> {
    const annotations = selectedItems.filter(
      (item) => getImageAnnotationCandidate(item) !== undefined,
    );
    if (annotations.length === 0) {
      popup
        .changeLine({
          progress: 100,
          text: getString("batch-progress-no-annotations"),
          type: "fail",
        })
        .startCloseTimer(3_000);
      return;
    }
    let created = 0;
    let skipped = 0;
    let failed = 0;
    for (let index = 0; index < annotations.length; index++) {
      throwIfAborted(signal);
      const annotation = annotations[index];
      const baseCandidate = getImageAnnotationCandidate(annotation);
      const comment = baseCandidate
        ? promptFigureCaption(
            annotation.annotationComment ?? baseCandidate.comment,
          )
        : null;
      if (comment === null) {
        popup.changeLine({
          progress: Math.round(((index + 1) / annotations.length) * 100),
          text: getString("batch-progress-finished-item", {
            args: { current: index + 1, total: annotations.length },
          }),
        });
        continue;
      }
      const candidate = baseCandidate
        ? { ...baseCandidate, comment: comment.trim() }
        : undefined;
      const attachment = annotation.parentID
        ? Zotero.Items.get(annotation.parentID)
        : false;
      try {
        if (!candidate || !attachment || !attachment.isPDFAttachment()) {
          throw new Error("Image annotation has no PDF attachment");
        }
        const image =
          (await readReaderAnnotationCacheImage(
            annotation.libraryID,
            annotation.key,
          )) ??
          (await this.layoutAnalyzer.renderAnnotationCrop(
            attachment,
            candidate.pageIndex,
            candidate.rect,
            signal,
          ));
        const result = await this.resultStore.reconcilePage(
          attachment,
          candidate.pageIndex,
          [candidate],
          [image],
          "skip-existing",
          signal,
        );
        created += result.created;
        skipped += result.skipped;
      } catch (error) {
        if (isCancellationError(error)) throw error;
        failed++;
        ztoolkit.log("Image annotation import failed", {
          annotationID: annotation.id,
          error: toError(error),
        });
      }
      popup.changeLine({
        progress: Math.round(((index + 1) / annotations.length) * 100),
        text: getString("batch-progress-finished-item", {
          args: { current: index + 1, total: annotations.length },
        }),
      });
    }
    popup
      .changeLine({
        progress: 100,
        text: getString("batch-progress-import-done", {
          args: { created, skipped, failed },
        }),
        type: failed === annotations.length ? "fail" : "success",
      })
      .startCloseTimer(failed > 0 ? 5_000 : 3_000);
  }

  private createAttachmentProgress(
    popup: ProgressWindowHelper,
    attachmentIndex: number,
    attachmentCount: number,
    title: string,
  ): AnalysisProgress {
    return {
      update: (detail, pageProgress) => {
        if (this.runController?.signal.aborted) return;
        popup.changeLine({
          progress: Math.round(
            ((attachmentIndex + pageProgress / 100) / attachmentCount) * 100,
          ),
          text: getString("batch-progress-current", {
            args: {
              current: attachmentIndex + 1,
              detail,
              title,
              total: attachmentCount,
            },
          }),
        });
      },
    };
  }

  private createProgress(): ProgressWindowHelper {
    return new ztoolkit.ProgressWindow(config.addonName, {
      closeOtherProgressWindows: true,
      closeTime: -1,
      window: Zotero.getMainWindow(),
    })
      .createLine({
        progress: 0,
        text: getString("progress-initializing"),
        type: "default",
      })
      .show();
  }
}

export async function resolvePdfAttachments(
  items: readonly Zotero.Item[],
): Promise<Zotero.Item[]> {
  const attachments: Zotero.Item[] = [];
  const seen = new Set<number>();
  for (const item of items) {
    let attachment: Zotero.Item | false = item;
    if (item.isRegularItem()) {
      try {
        attachment = await item.getBestAttachment();
      } catch (error) {
        ztoolkit.log("Unable to resolve the selected item's PDF", {
          error: toError(error),
          itemID: item.id,
        });
        continue;
      }
    }
    if (!attachment || !attachment.isPDFAttachment()) continue;
    if (seen.has(attachment.id)) continue;
    seen.add(attachment.id);
    attachments.push(attachment);
  }
  return attachments;
}

function hasSupportedSelection(): boolean {
  return getSelectedItems().some(
    (item) => item.isRegularItem() || item.isPDFAttachment(),
  );
}

function hasImageAnnotationSelection(): boolean {
  return getSelectedItems().some(
    (item) => getImageAnnotationCandidate(item) !== undefined,
  );
}

function getSelectedItems(): Zotero.Item[] {
  return Zotero.getActiveZoteroPane()?.getSelectedItems() ?? [];
}

function getAttachmentTitle(attachment: Zotero.Item): string {
  return (
    attachment.topLevelItem?.getDisplayTitle() || attachment.getDisplayTitle()
  );
}

function promptFigureCaption(defaultValue: string): string | null {
  return Zotero.getMainWindow().prompt(
    getString("prompt-figure-caption"),
    defaultValue.trim(),
  );
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
