import * as assert from "node:assert/strict";
import test from "node:test";
import type { DialogHelper } from "zotero-plugin-toolkit";
import type { Rect } from "../src/domain/layout";
import {
  getCorrectionDialogSize,
  SidebarResultEditorController,
  type SidebarResultEditorControllerOptions,
} from "../src/features/reader/sidebarResultEditorController";
import {
  getFittedResultRegionPageSize,
  type ResultCorrectionPreview,
} from "../src/features/reader/resultRegionEditor";
import type { StoredFigureResult } from "../src/services/results/figureResultStore";
import type { FormulaLatexEditSnapshot } from "../src/services/formula/formulaLatexCoordinator";
import type {
  MonacoLatexEditorOptions,
  MonacoLatexEditorSession,
} from "../src/features/reader/monacoLatexEditor";

test("builds the comment dialog and returns the saved result", async () => {
  const edited = { ...createResult("comment"), comment: "edited" };
  const harness = createHarness({
    onEditComment: async (result, comment) => {
      assert.equal(result.id, "comment");
      assert.equal(comment, "edited");
      return edited;
    },
  });
  const request = harness.controller.editComment(createResult("comment"));
  const dialog = harness.dialogs[0] as FakeDialog;
  const textarea = getCommentTextarea(dialog);

  assert.equal(dialog.title, "sidebar-edit-comment-title");
  assert.deepEqual(dialog.buttons, [
    ["sidebar-edit-comment-save", "save"],
    ["sidebar-edit-comment-cancel", "cancel"],
  ]);
  assert.deepEqual(dialog.features, {
    centerscreen: true,
    fitContent: true,
    noDialogMode: true,
    resizable: true,
  });
  assert.equal(textarea.attributes.maxlength, 10_000);
  assert.equal(textarea.attributes.rows, 2);
  assert.equal(textarea.styles.height, "4.1em");
  assert.equal(textarea.styles.maxHeight, "4.1em");
  assert.equal(textarea.styles.minHeight, "4.1em");
  assert.equal(textarea.styles.resize, "none");

  dialog.windowTarget.dispatchEvent(new Event("load"));
  assert.equal(dialog.document.textarea.focusCalls, 1);
  assert.deepEqual(dialog.document.textarea.selection, [7, 7]);
  (dialog.data as CommentData).comment = "edited";
  dialog.finish("save");

  assert.equal(await request, edited);
  harness.controller.dispose();
});

test("supersedes comment dialogs and rejects a detached callback result", async () => {
  const editResult = createDeferred<StoredFigureResult | undefined>();
  let editCalls = 0;
  const harness = createHarness({
    onEditComment: async () => {
      editCalls++;
      return editResult.promise;
    },
  });
  const first = harness.controller.editComment(createResult("first"));
  const firstDialog = harness.dialogs[0] as FakeDialog;
  const second = harness.controller.editComment(createResult("second"));
  const secondDialog = harness.dialogs[1] as FakeDialog;

  assert.equal(firstDialog.closeCalls, 1);
  assert.equal(await first, undefined);
  firstDialog.windowTarget.dispatchEvent(new Event("load"));
  assert.equal(firstDialog.document.textarea.focusCalls, 0);

  secondDialog.finish("save");
  await waitFor(() => editCalls === 1);
  harness.controller.setContext({} as Document);
  editResult.resolve(createResult("second"));

  assert.equal(await second, undefined);
  harness.controller.dispose();
});

test("edits cached formula LaTeX in a dedicated source dialog", async () => {
  const source = {
    ...createResult("formula"),
    kind: "formula" as const,
    latex: "x^2",
    tag: "Formula 1",
  };
  const edited = { ...source, latex: "x^2 + y^2" };
  const harness = createHarness({
    onEditLatex: async (edit, latex) => {
      assert.equal(edit.result, source);
      assert.equal(latex, "x^2 + y^2");
      return edited;
    },
  });
  const request = harness.controller.editLatex(source);
  await waitFor(() => harness.latexEditors.length === 1);
  const editor = harness.latexEditors[0] as FakeLatexEditor;

  assert.deepEqual(editor.options, {
    cancelLabel: "sidebar-edit-latex-cancel",
    initialValue: "x^2",
    saveLabel: "sidebar-edit-latex-save",
    title: "sidebar-edit-latex-title",
  });
  assert.equal(editor.ownerWindow, harness.mainWindow);
  editor.finish("x^2 + y^2");

  assert.equal(await request, edited);
  harness.controller.dispose();
});

test("cancels a superseded Monaco editor without saving stale LaTeX", async () => {
  const harness = createHarness();
  const first = harness.controller.editLatex(createFormula("first", "x"));
  await waitFor(() => harness.latexEditors.length === 1);
  const firstEditor = harness.latexEditors[0] as FakeLatexEditor;
  const second = harness.controller.editLatex(createFormula("second", "y"));
  await waitFor(() => harness.latexEditors.length === 2);
  const secondEditor = harness.latexEditors[1] as FakeLatexEditor;

  assert.equal(firstEditor.closeCalls, 1);
  assert.equal(await first, undefined);
  secondEditor.finish(undefined);
  assert.equal(await second, undefined);
  harness.controller.dispose();
});

test("ignores an out-of-order region preview and cleans the installed editor", async () => {
  const firstPreview = createDeferred<ResultCorrectionPreview>();
  const secondPreview = createDeferred<ResultCorrectionPreview>();
  const corrected = createResult("second");
  let cleanupCalls = 0;
  let installCalls = 0;
  let resetCalls = 0;
  const harness = createHarness({
    installRegionEditor: (_document, host, preview, dialogData) => {
      installCalls++;
      assert.equal(host, harness.dialogs[0]?.document.host);
      assert.equal(preview, secondPreviewValue);
      assert.deepEqual(dialogData.rect, secondPreviewValue.rect);
      return {
        dispose: () => cleanupCalls++,
        reset: () => resetCalls++,
      };
    },
    onCorrectRegion: async (result, rect) => {
      assert.equal(result.id, "second");
      assert.deepEqual(rect, [0.2, 0.2, 0.8, 0.8]);
      return corrected;
    },
    onPrepareCorrection: (result) =>
      result.id === "first" ? firstPreview.promise : secondPreview.promise,
  });

  const first = harness.controller.correctRegion(createResult("first"));
  const second = harness.controller.correctRegion(createResult("second"));
  firstPreview.resolve(createPreview());
  assert.equal(await first, undefined);
  assert.equal(harness.dialogs.length, 0);

  secondPreview.resolve(secondPreviewValue);
  await waitFor(() => harness.dialogs.length === 1);
  const dialog = harness.dialogs[0] as FakeDialog;
  assert.equal(dialog.title, "sidebar-correct-region-title");
  assert.deepEqual(dialog.buttons, [
    ["sidebar-correct-region-reset", "reset"],
    ["sidebar-correct-region-save", "save"],
    ["sidebar-correct-region-cancel", "cancel"],
  ]);
  assert.equal(dialog.buttonOptions.get("reset")?.noClose, true);
  assert.deepEqual(dialog.features, {
    centerscreen: true,
    fitContent: false,
    height: 760,
    noDialogMode: true,
    resizable: true,
    width: 840,
  });
  dialog.windowTarget.dispatchEvent(new Event("load"));
  assert.equal(installCalls, 1);
  dialog.click("reset");
  assert.equal(resetCalls, 1);
  assert.equal(dialog.closeCalls, 0);
  (dialog.data as CorrectionData).rect = [0.2, 0.2, 0.8, 0.8];
  dialog.finish("save");

  assert.equal(await second, corrected);
  assert.equal(cleanupCalls, 1);
  dialog.windowTarget.dispatchEvent(new Event("load"));
  assert.equal(installCalls, 1);
  harness.controller.dispose();
});

test("sizes the correction window to the screen and enlarges dense previews", () => {
  const largeDocument = {
    defaultView: { screen: { availHeight: 1000, availWidth: 1600 } },
  } as unknown as Document;
  const smallDocument = {
    defaultView: { screen: { availHeight: 500, availWidth: 700 } },
  } as unknown as Document;

  assert.deepEqual(getCorrectionDialogSize({} as Document), {
    height: 760,
    width: 840,
  });
  assert.deepEqual(getCorrectionDialogSize(largeDocument), {
    height: 860,
    width: 900,
  });
  assert.deepEqual(getCorrectionDialogSize(smallDocument), {
    height: 468,
    width: 640,
  });
  assert.deepEqual(getFittedResultRegionPageSize(158, 212, 1000, 700), {
    height: 700,
    width: 521,
  });
  assert.deepEqual(getFittedResultRegionPageSize(640, 360, 900, 600), {
    height: 506,
    width: 900,
  });
});

test("drops a correction that finishes after its Reader context detaches", async () => {
  const correction = createDeferred<StoredFigureResult | undefined>();
  let correctionCalls = 0;
  let cleanupCalls = 0;
  const harness = createHarness({
    installRegionEditor: () => ({
      dispose: () => cleanupCalls++,
      reset: () => {},
    }),
    onCorrectRegion: async () => {
      correctionCalls++;
      return correction.promise;
    },
  });
  const request = harness.controller.correctRegion(createResult("region"));
  await waitFor(() => harness.dialogs.length === 1);
  const dialog = harness.dialogs[0] as FakeDialog;
  dialog.windowTarget.dispatchEvent(new Event("load"));
  dialog.finish("save");
  await waitFor(() => correctionCalls === 1);

  harness.controller.setContext(undefined);
  correction.resolve(createResult("region"));

  assert.equal(await request, undefined);
  assert.equal(cleanupCalls, 1);
  harness.controller.dispose();
});

test("aborts correction preview and persistence when the Reader detaches", async () => {
  let previewSignal: AbortSignal | undefined;
  const previewHarness = createHarness({
    onPrepareCorrection: async (_result, signal) => {
      previewSignal = signal;
      return await abortable<ResultCorrectionPreview>(signal);
    },
  });
  const previewRequest = previewHarness.controller.correctRegion(
    createResult("preview"),
  );
  await waitFor(() => previewSignal !== undefined);
  previewHarness.controller.setContext(undefined);

  assert.equal(previewSignal?.aborted, true);
  assert.equal(await previewRequest, undefined);
  previewHarness.controller.dispose();

  let correctionSignal: AbortSignal | undefined;
  const correctionHarness = createHarness({
    onCorrectRegion: async (_result, _rect, signal) => {
      correctionSignal = signal;
      return await abortable<StoredFigureResult | undefined>(signal);
    },
  });
  const correctionRequest = correctionHarness.controller.correctRegion(
    createResult("correction"),
  );
  await waitFor(() => correctionHarness.dialogs.length === 1);
  (correctionHarness.dialogs[0] as FakeDialog).finish("save");
  await waitFor(() => correctionSignal !== undefined);
  correctionHarness.controller.setContext(undefined);

  assert.equal(correctionSignal?.aborted, true);
  assert.equal(await correctionRequest, undefined);
  correctionHarness.controller.dispose();
});

test("cancels all editor types on detach and remains reusable until dispose", async () => {
  let cleanupCalls = 0;
  const harness = createHarness({
    installRegionEditor: () => ({
      dispose: () => cleanupCalls++,
      reset: () => {},
    }),
  });
  const comment = harness.controller.editComment(createResult("comment"));
  const commentDialog = harness.dialogs[0] as FakeDialog;
  const correction = harness.controller.correctRegion(createResult("region"));
  await waitFor(() => harness.dialogs.length === 2);
  const correctionDialog = harness.dialogs[1] as FakeDialog;
  correctionDialog.windowTarget.dispatchEvent(new Event("load"));
  const latex = harness.controller.editLatex(createFormula("formula", "x"));
  await waitFor(() => harness.latexEditors.length === 1);
  const latexEditor = harness.latexEditors[0] as FakeLatexEditor;

  harness.controller.setContext(undefined);
  assert.equal(commentDialog.closeCalls, 1);
  assert.equal(correctionDialog.closeCalls, 1);
  assert.equal(latexEditor.closeCalls, 1);
  assert.equal(await comment, undefined);
  assert.equal(await correction, undefined);
  assert.equal(await latex, undefined);
  assert.equal(cleanupCalls, 1);

  harness.controller.setContext({} as Document);
  const reused = harness.controller.editComment(createResult("reused"));
  const reusedDialog = harness.dialogs[2] as FakeDialog;
  reusedDialog.finish("cancel");
  assert.equal(await reused, undefined);

  harness.controller.dispose();
  harness.controller.setContext({} as Document);
  assert.equal(
    await harness.controller.editComment(createResult("disposed")),
    undefined,
  );
  assert.equal(harness.dialogs.length, 3);
});

interface HarnessOverrides {
  installRegionEditor?: NonNullable<
    SidebarResultEditorControllerOptions["installRegionEditor"]
  >;
  onCorrectRegion?: SidebarResultEditorControllerOptions["onCorrectRegion"];
  onEditComment?: SidebarResultEditorControllerOptions["onEditComment"];
  onEditLatex?: SidebarResultEditorControllerOptions["onEditLatex"];
  onPrepareCorrection?: SidebarResultEditorControllerOptions["onPrepareCorrection"];
  onPrepareLatexEdit?: SidebarResultEditorControllerOptions["onPrepareLatexEdit"];
}

function createHarness(overrides: HarnessOverrides = {}): {
  controller: SidebarResultEditorController;
  dialogs: FakeDialog[];
  latexEditors: FakeLatexEditor[];
  mainWindow: Window;
} {
  const dialogs: FakeDialog[] = [];
  const latexEditors: FakeLatexEditor[] = [];
  const mainWindow = {} as Window;
  const readerWindow = {} as Window;
  const controller = new SidebarResultEditorController({
    createDialog: () => {
      const dialog = new FakeDialog();
      dialogs.push(dialog);
      return dialog as unknown as DialogHelper;
    },
    formatString: (key) => key,
    installRegionEditor:
      overrides.installRegionEditor ??
      (() => ({ dispose: () => {}, reset: () => {} })),
    logError: (error) => assert.fail(error.message),
    openLatexEditor: (ownerWindow, options) => {
      const editor = new FakeLatexEditor(ownerWindow, options);
      latexEditors.push(editor);
      return editor;
    },
    onCorrectRegion: overrides.onCorrectRegion ?? (async (result) => result),
    onEditComment: overrides.onEditComment ?? (async (result) => result),
    onEditLatex: overrides.onEditLatex ?? (async (edit) => edit.result),
    onPrepareCorrection:
      overrides.onPrepareCorrection ?? (async () => createPreview()),
    onPrepareLatexEdit:
      overrides.onPrepareLatexEdit ??
      (async (result) => createFormulaEditSnapshot(result)),
    ownerWindow: mainWindow,
  });
  controller.setContext({ defaultView: readerWindow } as unknown as Document);
  return { controller, dialogs, latexEditors, mainWindow };
}

function createFormulaEditSnapshot(
  result: StoredFigureResult,
): FormulaLatexEditSnapshot | undefined {
  return result.latex
    ? {
        imageIdentity: `identity:${result.imagePath}`,
        latex: result.latex,
        result,
      }
    : undefined;
}

interface CommentData {
  _lastButtonId?: string;
  comment: string;
  unloadLock?: Deferred<void>;
}

interface CorrectionData {
  _lastButtonId?: string;
  rect: Rect;
  unloadLock?: Deferred<void>;
}

class FakeDialog {
  public readonly buttons: Array<[string, string | undefined]> = [];
  public readonly buttonOptions = new Map<
    string,
    { callback?: (event: Event) => unknown; noClose?: boolean }
  >();
  public closeCalls = 0;
  public data: CommentData | CorrectionData = { comment: "" };
  public readonly document = new FakeDialogDocument();
  public features: Record<string, boolean | number> | undefined;
  public readonly cells: unknown[] = [];
  public title = "";
  public readonly windowTarget: EventTarget & {
    close(): void;
    document: Document;
  };

  constructor() {
    const target = new EventTarget() as EventTarget & {
      close(): void;
      document: Document;
    };
    target.document = this.document as unknown as Document;
    target.close = () => {
      this.closeCalls++;
      this.data.unloadLock?.resolve();
    };
    this.windowTarget = target;
  }

  public get window(): Window {
    return this.windowTarget as unknown as Window;
  }

  public setDialogData(data: CommentData | CorrectionData): this {
    this.data = data;
    if ("comment" in data) this.document.textarea.value = data.comment;
    return this;
  }

  public addCell(_row: number, _column: number, value: unknown): this {
    this.cells.push(value);
    return this;
  }

  public addButton(
    label: string,
    id?: string,
    options: { callback?: (event: Event) => unknown; noClose?: boolean } = {},
  ): this {
    this.buttons.push([label, id]);
    if (id) this.buttonOptions.set(id, options);
    return this;
  }

  public click(buttonID: string): void {
    const options = this.buttonOptions.get(buttonID);
    this.data._lastButtonId = buttonID;
    options?.callback?.(new Event("click"));
    if (!options?.noClose) this.data.unloadLock?.resolve();
  }

  public open(
    title: string,
    features?: Record<string, boolean | number>,
  ): this {
    this.title = title;
    this.features = features;
    this.data.unloadLock = createDeferred<void>();
    return this;
  }

  public finish(buttonID: string): void {
    this.data._lastButtonId = buttonID;
    this.data.unloadLock?.resolve();
  }
}

class FakeDialogDocument {
  public readonly host = {} as HTMLElement;
  public readonly textarea = new FakeTextarea();

  public querySelector(selector: string): HTMLElement | null {
    if (selector === "#zoterofigure-comment-editor") {
      return this.textarea as unknown as HTMLElement;
    }
    if (selector === "#zoterofigure-region-editor") return this.host;
    return null;
  }
}

class FakeLatexEditor implements MonacoLatexEditorSession {
  public closeCalls = 0;
  private readonly deferred = createDeferred<string | undefined>();
  private settled = false;
  public readonly result = this.deferred.promise;

  constructor(
    public readonly ownerWindow: Window,
    public readonly options: MonacoLatexEditorOptions,
  ) {}

  public close(): void {
    if (this.settled) return;
    this.closeCalls++;
    this.finish(undefined);
  }

  public finish(value: string | undefined): void {
    if (this.settled) return;
    this.settled = true;
    this.deferred.resolve(value);
  }
}

class FakeTextarea {
  public focusCalls = 0;
  public selection: [number, number] | undefined;
  public value = "";

  public focus(): void {
    this.focusCalls++;
  }

  public setSelectionRange(start: number, end: number): void {
    this.selection = [start, end];
  }
}

interface CommentTextareaDefinition {
  attributes: Record<string, number | string>;
  styles: Record<string, string>;
}

function getCommentTextarea(dialog: FakeDialog): CommentTextareaDefinition {
  const cell = dialog.cells[0] as {
    children: Array<CommentTextareaDefinition & { tag: string }>;
  };
  const textarea = cell.children.find((child) => child.tag === "textarea");
  assert.ok(textarea);
  return textarea;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function createResult(id: string): StoredFigureResult {
  return {
    comment: id === "comment" ? "comment" : id,
    id,
    imageFile: `${id}.png`,
    imagePath: `/tmp/${id}.png`,
    kind: "figure",
    pageIndex: 0,
    pageLabel: "1",
    rect: [0.1, 0.1, 0.9, 0.9],
    tag: "Figure 1",
  };
}

function createFormula(id: string, latex: string): StoredFigureResult {
  return {
    ...createResult(id),
    kind: "formula",
    latex,
    tag: "Formula 1",
  };
}

const secondPreviewValue: ResultCorrectionPreview = {
  detectedRect: [0.1, 0.1, 0.9, 0.9],
  imageURL: "data:image/jpeg;base64,second",
  rect: [0.15, 0.15, 0.85, 0.85],
};

function createPreview(): ResultCorrectionPreview {
  return {
    detectedRect: [0.1, 0.1, 0.9, 0.9],
    imageURL: "data:image/jpeg;base64,",
    rect: [0.1, 0.1, 0.9, 0.9],
  };
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("Timed out waiting for result editor lifecycle");
}

function abortable<T>(signal: AbortSignal): Promise<T> {
  return new Promise<T>((_resolve, reject) => {
    const abort = () => reject(new DOMException("Aborted", "AbortError"));
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}
