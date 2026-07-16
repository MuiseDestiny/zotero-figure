import type { DialogHelper } from "zotero-plugin-toolkit";
import type { Rect } from "../../domain/layout";
import type { StoredFigureResult } from "../../services/results/figureResultStore";
import { getString } from "../../utils/locale";
import {
  installResultRegionEditor,
  type ResultCorrectionPreview,
  type ResultRegionDialogData,
} from "./resultRegionEditor";

const COMMENT_EDITOR_MAX_LENGTH = 10_000;

interface DialogUnloadLock {
  promise: Promise<void>;
  resolve(): void;
}

interface CommentDialogData {
  _lastButtonId?: string;
  comment: string;
  unloadLock?: DialogUnloadLock;
}

interface CorrectionDialogData extends ResultRegionDialogData {
  _lastButtonId?: string;
  unloadLock?: DialogUnloadLock;
}

type CreateDialog = () => DialogHelper;
type FormatString = (key: string) => string;
type InstallRegionEditor = typeof installResultRegionEditor;

export interface SidebarResultEditorControllerOptions {
  createDialog?: CreateDialog;
  formatString?: FormatString;
  installRegionEditor?: InstallRegionEditor;
  logError?(error: Error): void;
  onCorrectRegion(
    result: StoredFigureResult,
    rect: Rect,
  ): Promise<StoredFigureResult | undefined>;
  onEditComment(
    result: StoredFigureResult,
    comment: string,
  ): Promise<StoredFigureResult | undefined>;
  onPrepareCorrection(
    result: StoredFigureResult,
  ): Promise<ResultCorrectionPreview>;
}

/** Owns the two modal result-editing workflows for one reusable Reader panel. */
export class SidebarResultEditorController {
  private commentDialog?: DialogHelper;
  private commentGeneration = 0;
  private context?: Document;
  private correctionDialog?: DialogHelper;
  private correctionGeneration = 0;
  private readonly createDialog: CreateDialog;
  private disposed = false;
  private readonly formatString: FormatString;
  private readonly installRegionEditor: InstallRegionEditor;
  private readonly logError: (error: Error) => void;

  constructor(private readonly options: SidebarResultEditorControllerOptions) {
    this.createDialog =
      options.createDialog ?? (() => new ztoolkit.Dialog(1, 1));
    this.formatString = options.formatString ?? ((key) => getString(key));
    this.installRegionEditor =
      options.installRegionEditor ?? installResultRegionEditor;
    this.logError =
      options.logError ?? ((error) => Zotero.logError(toError(error)));
  }

  public setContext(document: Document | undefined): void {
    if (this.disposed || this.context === document) return;
    this.context = document;
    this.cancelAll();
  }

  public cancelAll(): void {
    this.commentGeneration++;
    this.correctionGeneration++;
    const commentDialog = this.commentDialog;
    const correctionDialog = this.correctionDialog;
    this.commentDialog = undefined;
    this.correctionDialog = undefined;
    this.closeDialog(commentDialog);
    this.closeDialog(correctionDialog);
  }

  public async editComment(
    result: StoredFigureResult,
  ): Promise<StoredFigureResult | undefined> {
    const context = this.context;
    if (this.disposed || !context) return undefined;
    const generation = ++this.commentGeneration;
    const previousDialog = this.commentDialog;
    this.commentDialog = undefined;
    this.closeDialog(previousDialog);

    const dialogData: CommentDialogData = { comment: result.comment };
    const dialog = this.createDialog()
      .setDialogData(dialogData)
      .addCell(0, 0, this.createCommentEditorCell())
      .addButton(this.formatString("sidebar-edit-comment-save"), "save")
      .addButton(this.formatString("sidebar-edit-comment-cancel"), "cancel")
      .open(this.formatString("sidebar-edit-comment-title"), {
        centerscreen: true,
        fitContent: true,
        noDialogMode: true,
        resizable: true,
      });
    this.commentDialog = dialog;
    const handleLoad = (): void => {
      if (!this.isCurrentCommentRequest(context, generation, dialog)) return;
      const textarea =
        dialog.window.document.querySelector<HTMLTextAreaElement>(
          "#zoterofigure-comment-editor",
        );
      textarea?.focus();
      textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
    };
    dialog.window.addEventListener("load", handleLoad, { once: true });
    try {
      await dialogData.unloadLock?.promise;
      if (
        dialogData._lastButtonId !== "save" ||
        !this.isCurrentCommentRequest(context, generation, dialog)
      ) {
        return undefined;
      }
      const updated = await this.options.onEditComment(
        result,
        dialogData.comment,
      );
      return updated &&
        this.isCurrentCommentRequest(context, generation, dialog)
        ? updated
        : undefined;
    } finally {
      dialog.window.removeEventListener("load", handleLoad);
      if (this.commentDialog === dialog) this.commentDialog = undefined;
    }
  }

  public async correctRegion(
    result: StoredFigureResult,
  ): Promise<StoredFigureResult | undefined> {
    const context = this.context;
    if (this.disposed || !context) return undefined;
    const generation = ++this.correctionGeneration;
    const previousDialog = this.correctionDialog;
    this.correctionDialog = undefined;
    this.closeDialog(previousDialog);

    const preview = await this.options.onPrepareCorrection(result);
    if (!this.isCurrentCorrectionRequest(context, generation)) {
      return undefined;
    }
    const dialogData: CorrectionDialogData = { rect: [...preview.rect] };
    const dialog = this.createDialog()
      .setDialogData(dialogData)
      .addCell(0, 0, {
        tag: "div",
        id: "zoterofigure-region-editor",
      })
      .addButton(this.formatString("sidebar-correct-region-save"), "save")
      .addButton(this.formatString("sidebar-correct-region-cancel"), "cancel")
      .open(this.formatString("sidebar-correct-region-title"), {
        centerscreen: true,
        fitContent: true,
        noDialogMode: true,
        resizable: true,
      });
    this.correctionDialog = dialog;
    let cleanup = () => {};
    const handleLoad = (): void => {
      if (!this.isCurrentCorrectionRequest(context, generation, dialog)) {
        return;
      }
      const host = dialog.window.document.querySelector<HTMLElement>(
        "#zoterofigure-region-editor",
      );
      if (host) {
        cleanup = this.installRegionEditor(
          dialog.window.document,
          host,
          preview,
          dialogData,
        );
      }
    };
    dialog.window.addEventListener("load", handleLoad, { once: true });
    try {
      await dialogData.unloadLock?.promise;
      if (
        dialogData._lastButtonId !== "save" ||
        !this.isCurrentCorrectionRequest(context, generation, dialog)
      ) {
        return undefined;
      }
      const updated = await this.options.onCorrectRegion(
        result,
        dialogData.rect,
      );
      return updated &&
        this.isCurrentCorrectionRequest(context, generation, dialog)
        ? updated
        : undefined;
    } finally {
      dialog.window.removeEventListener("load", handleLoad);
      cleanup();
      if (this.correctionDialog === dialog) {
        this.correctionDialog = undefined;
      }
    }
  }

  public dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.context = undefined;
    this.cancelAll();
  }

  private createCommentEditorCell(): Parameters<DialogHelper["addCell"]>[2] {
    return {
      tag: "div",
      styles: {
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        minWidth: "420px",
        width: "100%",
      },
      children: [
        {
          tag: "label",
          attributes: { for: "zoterofigure-comment-editor" },
          properties: {
            textContent: this.formatString("sidebar-edit-comment-description"),
          },
          styles: {
            color: "var(--fill-secondary)",
            fontSize: "12px",
          },
        },
        {
          tag: "textarea",
          id: "zoterofigure-comment-editor",
          attributes: {
            "data-bind": "comment",
            "data-prop": "value",
            maxlength: COMMENT_EDITOR_MAX_LENGTH,
            rows: 2,
          },
          styles: {
            background: "var(--material-background)",
            border: "1px solid var(--fill-quaternary)",
            borderRadius: "5px",
            boxSizing: "border-box",
            color: "var(--fill-primary)",
            font: "inherit",
            height: "4.1em",
            lineHeight: "1.45",
            maxHeight: "4.1em",
            minHeight: "4.1em",
            overflowY: "auto",
            padding: "8px",
            resize: "none",
            width: "100%",
          },
        },
      ],
    };
  }

  private isCurrentCommentRequest(
    context: Document,
    generation: number,
    dialog?: DialogHelper,
  ): boolean {
    return (
      !this.disposed &&
      this.context === context &&
      this.commentGeneration === generation &&
      (dialog === undefined || this.commentDialog === dialog)
    );
  }

  private isCurrentCorrectionRequest(
    context: Document,
    generation: number,
    dialog?: DialogHelper,
  ): boolean {
    return (
      !this.disposed &&
      this.context === context &&
      this.correctionGeneration === generation &&
      (dialog === undefined || this.correctionDialog === dialog)
    );
  }

  private closeDialog(dialog: DialogHelper | undefined): void {
    if (!dialog) return;
    try {
      dialog.window?.close();
    } catch (error) {
      this.logError(toError(error));
    }
  }
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
