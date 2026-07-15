import type { ProgressWindowHelper } from "zotero-plugin-toolkit";
import { config } from "../../../package.json";
import { FigureOutputService } from "../../services/figureOutputService";
import {
  type AnalysisProgress,
  LayoutAnalyzer,
} from "../../services/layout/layoutAnalyzer";
import { FigureResultStore } from "../../services/results/figureResultStore";
import { getString } from "../../utils/locale";

type BatchAction = "analyze" | "annotations" | "note";

interface BatchTotals {
  annotations: number;
  failed: number;
  notes: number;
  results: number;
  succeeded: number;
}

const MENU_ID = `${config.addonRef}-item-menu`;
const MENU_ICON = `chrome://${config.addonRef}/content/icons/favicon.png`;

export class FigureBatchController {
  private activePopup?: ProgressWindowHelper;
  private readonly outputService: FigureOutputService;
  private running = false;
  private started = false;

  constructor(
    private readonly layoutAnalyzer: LayoutAnalyzer,
    private readonly resultStore: FigureResultStore,
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
  }

  public dispose(): void {
    if (!this.started) return;
    this.started = false;
    ztoolkit.Menu.unregister(MENU_ID);
  }

  private createMenuItem(labelKey: string, action: BatchAction) {
    return {
      commandListener: () => void this.run(action),
      label: getString(labelKey),
      tag: "menuitem" as const,
    };
  }

  private async run(action: BatchAction): Promise<void> {
    if (this.running) {
      this.activePopup?.changeLine({
        text: getString("batch-progress-already-running"),
      });
      return;
    }
    this.running = true;
    const popup = this.createProgress();
    this.activePopup = popup;
    try {
      const selectedItems = getSelectedItems();
      const attachments = await resolvePdfAttachments(selectedItems);
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
            { syncAnnotations: action === "annotations" },
          );
          const results = await this.resultStore.list(attachment);
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
          totals.succeeded++;
        } catch (error) {
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
      const resolvedError = toError(error);
      Zotero.logError(resolvedError);
      popup.changeLine({
        text: getString("progress-error", {
          args: { message: resolvedError.message },
        }),
        type: "fail",
      });
    } finally {
      if (this.activePopup === popup) this.activePopup = undefined;
      this.running = false;
    }
  }

  private createAttachmentProgress(
    popup: ProgressWindowHelper,
    attachmentIndex: number,
    attachmentCount: number,
    title: string,
  ): AnalysisProgress {
    return {
      update: (detail, pageProgress) => {
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

function getSelectedItems(): Zotero.Item[] {
  return Zotero.getActiveZoteroPane()?.getSelectedItems() ?? [];
}

function getAttachmentTitle(attachment: Zotero.Item): string {
  return (
    attachment.topLevelItem?.getDisplayTitle() || attachment.getDisplayTitle()
  );
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
