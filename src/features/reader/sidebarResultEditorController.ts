import type { DialogHelper } from "zotero-plugin-toolkit";
import type { Rect } from "../../domain/layout";
import type { FormulaLatexEditSnapshot } from "../../services/formula/formulaLatexCoordinator";
import type { StoredFigureResult } from "../../services/results/figureResultStore";
import { getString } from "../../utils/locale";
import {
  installResultRegionEditor,
  type ResultCorrectionPreview,
  type ResultRegionDialogData,
  type ResultRegionEditorSession,
} from "./resultRegionEditor";
import {
  openMonacoLatexEditor,
  type MonacoLatexEditorSession,
} from "./monacoLatexEditor";

const COMMENT_EDITOR_MAX_LENGTH = 10_000;
const CORRECTION_DIALOG_FALLBACK_WIDTH = 840;
const CORRECTION_DIALOG_FALLBACK_HEIGHT = 760;
const CORRECTION_DIALOG_MIN_WIDTH = 640;
const CORRECTION_DIALOG_MIN_HEIGHT = 560;
const CORRECTION_DIALOG_MAX_WIDTH = 900;
const CORRECTION_DIALOG_MAX_HEIGHT = 900;
const CORRECTION_DIALOG_SCREEN_RATIO = 0.86;
const CORRECTION_DIALOG_WIDTH_SCREEN_RATIO = 0.62;

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
type OpenLatexEditor = typeof openMonacoLatexEditor;

export interface SidebarResultEditorControllerOptions {
  createDialog?: CreateDialog;
  formatString?: FormatString;
  installRegionEditor?: InstallRegionEditor;
  logError?(error: Error): void;
  openLatexEditor?: OpenLatexEditor;
  ownerWindow?: Window;
  onCorrectRegion(
    result: StoredFigureResult,
    rect: Rect,
    signal: AbortSignal,
  ): Promise<StoredFigureResult | undefined>;
  onEditComment(
    result: StoredFigureResult,
    comment: string,
  ): Promise<StoredFigureResult | undefined>;
  onEditLatex(
    edit: FormulaLatexEditSnapshot,
    latex: string,
  ): Promise<StoredFigureResult | undefined>;
  onPrepareCorrection(
    result: StoredFigureResult,
    signal: AbortSignal,
  ): Promise<ResultCorrectionPreview>;
  onPrepareLatexEdit(
    result: StoredFigureResult,
  ): Promise<FormulaLatexEditSnapshot | undefined>;
}

/** Owns result-editing workflows for one reusable Reader panel. */
export class SidebarResultEditorController {
  private commentDialog?: DialogHelper;
  private commentGeneration = 0;
  private context?: Document;
  private correctionDialog?: DialogHelper;
  private correctionController?: AbortController;
  private correctionGeneration = 0;
  private latexEditor?: MonacoLatexEditorSession;
  private latexGeneration = 0;
  private readonly createDialog: CreateDialog;
  private disposed = false;
  private readonly formatString: FormatString;
  private readonly installRegionEditor: InstallRegionEditor;
  private readonly logError: (error: Error) => void;
  private readonly openLatexEditor: OpenLatexEditor;

  constructor(private readonly options: SidebarResultEditorControllerOptions) {
    this.createDialog =
      options.createDialog ?? (() => new ztoolkit.Dialog(1, 1));
    this.formatString = options.formatString ?? ((key) => getString(key));
    this.installRegionEditor =
      options.installRegionEditor ?? installResultRegionEditor;
    this.logError =
      options.logError ?? ((error) => Zotero.logError(toError(error)));
    this.openLatexEditor = options.openLatexEditor ?? openMonacoLatexEditor;
  }

  public setContext(document: Document | undefined): void {
    if (this.disposed || this.context === document) return;
    this.context = document;
    this.cancelAll();
  }

  public cancelAll(): void {
    this.commentGeneration++;
    this.correctionGeneration++;
    this.latexGeneration++;
    const commentDialog = this.commentDialog;
    const correctionDialog = this.correctionDialog;
    const correctionController = this.correctionController;
    const latexEditor = this.latexEditor;
    this.commentDialog = undefined;
    this.correctionDialog = undefined;
    this.correctionController = undefined;
    this.latexEditor = undefined;
    this.closeDialog(commentDialog);
    this.closeDialog(correctionDialog);
    correctionController?.abort();
    latexEditor?.close();
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
    const previousController = this.correctionController;
    this.correctionDialog = undefined;
    this.correctionController = undefined;
    this.closeDialog(previousDialog);
    previousController?.abort();
    const operationController = new AbortController();
    this.correctionController = operationController;

    let preview: ResultCorrectionPreview;
    try {
      preview = await this.options.onPrepareCorrection(
        result,
        operationController.signal,
      );
    } catch (error) {
      if (this.correctionController === operationController) {
        this.correctionController = undefined;
      }
      if (operationController.signal.aborted) return undefined;
      throw error;
    }
    if (!this.isCurrentCorrectionRequest(context, generation)) {
      if (this.correctionController === operationController) {
        this.correctionController = undefined;
      }
      return undefined;
    }
    const dialogData: CorrectionDialogData = { rect: [...preview.rect] };
    const dialogSize = getCorrectionDialogSize(context);
    let regionEditor: ResultRegionEditorSession | undefined;
    const dialog = this.createDialog()
      .setDialogData(dialogData)
      .addCell(0, 0, {
        tag: "div",
        id: "zoterofigure-region-editor",
      })
      .addButton(this.formatString("sidebar-correct-region-reset"), "reset", {
        noClose: true,
        callback: () => regionEditor?.reset(),
      })
      .addButton(this.formatString("sidebar-correct-region-save"), "save")
      .addButton(this.formatString("sidebar-correct-region-cancel"), "cancel")
      .open(this.formatString("sidebar-correct-region-title"), {
        centerscreen: true,
        fitContent: false,
        height: dialogSize.height,
        noDialogMode: true,
        resizable: true,
        width: dialogSize.width,
      });
    this.correctionDialog = dialog;
    const handleLoad = (): void => {
      if (!this.isCurrentCorrectionRequest(context, generation, dialog)) {
        return;
      }
      const host = dialog.window.document.querySelector<HTMLElement>(
        "#zoterofigure-region-editor",
      );
      if (host) {
        regionEditor = this.installRegionEditor(
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
        operationController.signal,
      );
      return updated &&
        this.isCurrentCorrectionRequest(context, generation, dialog)
        ? updated
        : undefined;
    } catch (error) {
      if (operationController.signal.aborted) return undefined;
      throw error;
    } finally {
      dialog.window.removeEventListener("load", handleLoad);
      regionEditor?.dispose();
      if (this.correctionDialog === dialog) {
        this.correctionDialog = undefined;
      }
      if (this.correctionController === operationController) {
        this.correctionController = undefined;
      }
    }
  }

  public async editLatex(
    result: StoredFigureResult,
  ): Promise<StoredFigureResult | undefined> {
    const context = this.context;
    logLatexEditor(
      `[Zotero Figure][LaTeX editor] controller request: id=${result.id}, disposed=${this.disposed}, context=${context ? "ready" : "missing"}, latexLength=${result.latex?.length ?? 0}`,
    );
    if (this.disposed || !context || !result.latex) {
      logLatexEditor(
        `[Zotero Figure][LaTeX editor] controller request skipped: id=${result.id}`,
      );
      return undefined;
    }
    const generation = ++this.latexGeneration;
    const previousEditor = this.latexEditor;
    this.latexEditor = undefined;
    previousEditor?.close();
    const edit = await this.options.onPrepareLatexEdit(result);
    if (!edit || !this.isCurrentLatexRequest(context, generation)) {
      return undefined;
    }
    const ownerWindow = this.options.ownerWindow ?? Zotero.getMainWindow();
    logLatexEditor(
      `[Zotero Figure][LaTeX editor] opening session: id=${result.id}, owner=${this.options.ownerWindow ? "configured-main-window" : "Zotero.getMainWindow"}, openDialog=${typeof ownerWindow?.openDialog}`,
    );
    const editor = this.openLatexEditor(ownerWindow, {
      cancelLabel: this.formatString("sidebar-edit-latex-cancel"),
      initialValue: edit.latex,
      saveLabel: this.formatString("sidebar-edit-latex-save"),
      title: this.formatString("sidebar-edit-latex-title"),
    });
    this.latexEditor = editor;
    logLatexEditor(
      `[Zotero Figure][LaTeX editor] awaiting editor result: id=${result.id}`,
    );
    try {
      const latex = await editor.result;
      logLatexEditor(
        `[Zotero Figure][LaTeX editor] editor result resolved: id=${result.id}, length=${latex?.length ?? 0}`,
      );
      if (
        !latex?.trim() ||
        !this.isCurrentLatexRequest(context, generation, editor)
      ) {
        logLatexEditor(
          `[Zotero Figure][LaTeX editor] editor result ignored: id=${result.id}, current=${this.isCurrentLatexRequest(context, generation, editor)}`,
        );
        return undefined;
      }
      logLatexEditor(
        `[Zotero Figure][LaTeX editor] persisting edited value: id=${result.id}`,
      );
      const updated = await this.options.onEditLatex(edit, latex);
      logLatexEditor(
        `[Zotero Figure][LaTeX editor] persistence completed: id=${result.id}, updated=${Boolean(updated)}`,
      );
      return updated && this.isCurrentLatexRequest(context, generation, editor)
        ? updated
        : undefined;
    } finally {
      logLatexEditor(
        `[Zotero Figure][LaTeX editor] controller cleanup: id=${result.id}`,
      );
      if (this.latexEditor === editor) this.latexEditor = undefined;
      editor.close();
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

  private isCurrentLatexRequest(
    context: Document,
    generation: number,
    editor?: MonacoLatexEditorSession,
  ): boolean {
    return (
      !this.disposed &&
      this.context === context &&
      this.latexGeneration === generation &&
      (editor === undefined || this.latexEditor === editor)
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

export function getCorrectionDialogSize(document: Document): {
  height: number;
  width: number;
} {
  const screen = document.defaultView?.screen;
  return {
    height: getAdaptiveDialogDimension(
      screen?.availHeight,
      CORRECTION_DIALOG_FALLBACK_HEIGHT,
      CORRECTION_DIALOG_MIN_HEIGHT,
      CORRECTION_DIALOG_MAX_HEIGHT,
    ),
    width: getAdaptiveDialogDimension(
      screen?.availWidth,
      CORRECTION_DIALOG_FALLBACK_WIDTH,
      CORRECTION_DIALOG_MIN_WIDTH,
      CORRECTION_DIALOG_MAX_WIDTH,
      CORRECTION_DIALOG_WIDTH_SCREEN_RATIO,
    ),
  };
}

function getAdaptiveDialogDimension(
  available: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  ratio = CORRECTION_DIALOG_SCREEN_RATIO,
): number {
  if (!Number.isFinite(available) || (available as number) <= 0) {
    return fallback;
  }
  const boundedAvailable = Math.max(320, Math.floor(available as number) - 32);
  const target = Math.round((available as number) * ratio);
  return Math.min(
    boundedAvailable,
    Math.max(minimum, Math.min(maximum, target)),
  );
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function logLatexEditor(message: string): void {
  if (typeof ztoolkit === "undefined") return;
  ztoolkit.log(message);
}
