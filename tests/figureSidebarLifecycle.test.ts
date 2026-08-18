import * as assert from "node:assert/strict";
import test from "node:test";
import type { PdfReader } from "../src/platform/zotero/reader";
import type { StoredFigureResult } from "../src/services/results/figureResultStore";
import {
  FigureSidebarPanel,
  type FigureSidebarPanelOptions,
} from "../src/features/reader/figureSidebarPanel";
import type { ResultCorrectionPreview } from "../src/features/reader/resultRegionEditor";

interface PanelInternals {
  openCommentEditor(result: StoredFigureResult): Promise<void>;
  openRegionEditor(result: StoredFigureResult): Promise<void>;
  pinnedCards: Map<
    string,
    { dispose(): void; element: Pick<HTMLElement, "contains"> }
  >;
  reconcilePinnedCards(results: readonly StoredFigureResult[]): void;
  requestPinnedCardRefresh(
    entry: { dispose(): void; element: Pick<HTMLElement, "contains"> },
    result: StoredFigureResult,
  ): void;
}

test("continues panel cleanup when restoring the native sidebar throws", () => {
  const panel = createPanel(async () => createPreview());
  const internals = panel as unknown as {
    active: boolean;
    detachDocument(): void;
    setInternalSidebarView(): void;
  };
  const previousZotero = globalThis.Zotero;
  let detached = 0;
  internals.active = true;
  internals.setInternalSidebarView = () => {
    throw new Error("reader already closed");
  };
  internals.detachDocument = () => detached++;
  globalThis.Zotero = {
    logError: () => {},
  } as unknown as typeof Zotero;
  try {
    panel.dispose();
  } finally {
    globalThis.Zotero = previousZotero;
  }
  assert.equal(detached, 1);
});

test("applies editor results while keeping their Panel outcomes separate", async () => {
  const panel = createPanel(async () => createPreview());
  const commentResult = createResult("comment");
  const regionResult = createResult("region");
  let applied: StoredFigureResult | undefined;
  let reloads = 0;
  const internals = panel as unknown as PanelInternals & {
    applyUpdatedResult(result: StoredFigureResult): void;
    document?: Document;
    reloadResults(): void;
    resultEditors: {
      correctRegion(): Promise<StoredFigureResult | undefined>;
      dispose(): void;
      editComment(): Promise<StoredFigureResult | undefined>;
      setContext(document: Document | undefined): void;
    };
  };
  internals.document = {} as Document;
  internals.resultEditors = {
    correctRegion: async () => regionResult,
    dispose: () => {},
    editComment: async () => commentResult,
    setContext: () => {},
  };
  internals.applyUpdatedResult = (result) => {
    applied = result;
  };
  internals.reloadResults = () => reloads++;

  await internals.openCommentEditor(createResult("source"));
  await internals.openRegionEditor(createResult("source"));

  assert.equal(applied, commentResult);
  assert.equal(reloads, 1);
  internals.document = undefined;
  panel.dispose();
});

test("disposes only pinned cards whose results no longer exist", () => {
  const panel = createPanel(async () => createPreview());
  const internals = panel as unknown as PanelInternals;
  let staleDisposals = 0;
  let retainedDisposals = 0;
  internals.pinnedCards.set("stale", {
    dispose: () => staleDisposals++,
    element: { contains: () => false },
  });
  internals.pinnedCards.set("retained", {
    dispose: () => retainedDisposals++,
    element: { contains: () => false },
  });
  internals.requestPinnedCardRefresh = () => {};

  internals.reconcilePinnedCards([createResult("retained")]);

  assert.equal(staleDisposals, 1);
  assert.equal(retainedDisposals, 0);
  assert.deepEqual([...internals.pinnedCards.keys()], ["retained"]);
  panel.dispose();
  assert.equal(retainedDisposals, 1);
});

test("refreshes a retained pinned card when the same result ID is overwritten", () => {
  const panel = createPanel(async () => createPreview());
  const internals = panel as unknown as PanelInternals;
  const entry = {
    dispose: () => assert.fail("same-ID cards must be retained"),
    element: { contains: () => false },
  };
  const updated = { ...createResult("retained"), comment: "new snapshot" };
  let refreshedResult: StoredFigureResult | undefined;
  internals.pinnedCards.set(updated.id, entry);
  internals.requestPinnedCardRefresh = (refreshedEntry, result) => {
    assert.equal(refreshedEntry, entry);
    refreshedResult = result;
  };

  internals.reconcilePinnedCards([updated]);

  assert.equal(refreshedResult, updated);
  assert.equal(internals.pinnedCards.get(updated.id), entry);
  internals.pinnedCards.clear();
  panel.dispose();
});

test("cancels a pending pinned refresh when the current result becomes latest again", () => {
  const panel = createPanel(async () => createPreview());
  const internals = panel as unknown as {
    requestPinnedCardRefresh(entry: unknown, result: StoredFigureResult): void;
  };
  const current = createResult("retained");
  const pending = { ...current, comment: "superseded" };
  let cancellations = 0;
  const entry = {
    cancelPendingSnapshotRefresh: () => cancellations++,
    dispose: () => {},
    element: {},
    pendingSnapshot: {
      displayComment: pending.comment,
      result: pending,
    },
    refreshSnapshot: async () => {
      assert.fail("the already displayed result does not need reloading");
    },
    snapshot: {
      displayComment: current.comment,
      result: current,
    },
  };

  internals.requestPinnedCardRefresh(entry, current);

  assert.equal(cancellations, 1);
  assert.equal(entry.pendingSnapshot, undefined);
  panel.dispose();
});

test("copies during recognition and still applies concurrent external LaTeX", async () => {
  const recognition = createDeferred<StoredFigureResult>();
  const source = { ...createResult("formula"), kind: "formula" as const };
  const recognized = { ...source, latex: "cloud" };
  const manual = { ...source, latex: "manual" };
  let copyCalls = 0;
  const ownerWindow = {
    clearTimeout: () => undefined,
    setTimeout: (callback: () => void) => {
      callback();
      return 1;
    },
  } as unknown as Window;
  const panel = createPanel(async () => createPreview(), {
    onCopyLatex: async () => {
      copyCalls++;
      return await recognition.promise;
    },
    onRerecognizeLatex: async () => await recognition.promise,
    ownerWindow,
  });
  const document = {} as Document;
  const anchor = { ownerDocument: document } as HTMLButtonElement;
  const applied: StoredFigureResult[] = [];
  const internals = panel as unknown as {
    applyUpdatedResult(result: StoredFigureResult): void;
    closeMenu(): void;
    copyFormulaLatex(
      anchor: HTMLButtonElement,
      result: StoredFigureResult,
    ): Promise<void>;
    document?: Document;
    rerecognizeFormulaLatex(
      anchor: HTMLButtonElement,
      result: StoredFigureResult,
    ): Promise<void>;
    results?: readonly StoredFigureResult[];
    setMenuButtonState(): void;
  };
  internals.document = document;
  internals.results = [source];
  internals.closeMenu = () => undefined;
  internals.setMenuButtonState = () => undefined;
  internals.applyUpdatedResult = (result) => applied.push(result);

  const rerecognize = internals.rerecognizeFormulaLatex(anchor, source);
  const copy = internals.copyFormulaLatex(anchor, source);
  panel.updateFormulaLatex(manual);

  assert.equal(copyCalls, 1);
  assert.equal(applied[0], manual);
  recognition.resolve(recognized);
  await Promise.all([rerecognize, copy]);
  assert.equal(applied.filter((result) => result === recognized).length, 2);

  internals.document = undefined;
  panel.dispose();
});

test("reloads after a formula update races the initial result snapshot", () => {
  const panel = createPanel(async () => createPreview());
  const internals = panel as unknown as {
    loadingResults: boolean;
    reloadAfterLoad: boolean;
    results?: readonly StoredFigureResult[];
  };
  internals.loadingResults = true;
  internals.reloadAfterLoad = false;
  internals.results = undefined;

  panel.updateFormulaLatex({
    ...createResult("formula"),
    kind: "formula",
    latex: "x",
  });

  assert.equal(internals.reloadAfterLoad, true);
  internals.loadingResults = false;
  panel.dispose();
});

test("does not apply a stale copy result after a newer formula update", async () => {
  const timers: Array<() => void> = [];
  const ownerWindow = {
    clearTimeout: () => undefined,
    setTimeout: (callback: () => void) => {
      timers.push(callback);
      return timers.length;
    },
  } as unknown as Window;
  const source = { ...createResult("formula"), kind: "formula" as const };
  const copied = { ...source, latex: "copied" };
  const manual = { ...source, latex: "manual" };
  const panel = createPanel(async () => createPreview(), {
    onCopyLatex: async () => copied,
    ownerWindow,
  });
  const document = {} as Document;
  const anchor = { ownerDocument: document } as HTMLButtonElement;
  const internals = panel as unknown as {
    closeMenu(): void;
    copyFormulaLatex(
      anchor: HTMLButtonElement,
      result: StoredFigureResult,
    ): Promise<void>;
    document?: Document;
    results?: readonly StoredFigureResult[];
    setMenuButtonState(): void;
  };
  internals.document = document;
  internals.results = [source];
  internals.closeMenu = () => undefined;
  internals.setMenuButtonState = () => undefined;

  const request = internals.copyFormulaLatex(anchor, source);
  await waitFor(() => timers.length === 1);
  panel.updateFormulaLatex(manual);
  timers[0]();
  await request;

  assert.equal(internals.results?.[0], manual);
  internals.document = undefined;
  panel.dispose();
});

test("applies recognition feedback to the current card menu button", () => {
  const panel = createPanel(async () => createPreview());
  const staleButton = {} as HTMLButtonElement;
  const currentButton = {} as HTMLButtonElement;
  const card = {
    isConnected: true,
    querySelector: () => currentButton,
  } as unknown as HTMLElement;
  const calls: Array<{
    action: "copy" | "rerecognize";
    button: HTMLButtonElement;
    state: "check" | "loading" | "menu";
  }> = [];
  const internals = panel as unknown as {
    setFormulaLatexRequestButtonState(
      anchor: HTMLButtonElement,
      sourceCard: HTMLElement,
      resultID: string,
      state: "check",
      action: "rerecognize",
    ): void;
    setMenuButtonState(
      button: HTMLButtonElement,
      state: "check" | "loading" | "menu",
      action: "copy" | "rerecognize",
    ): void;
  };
  internals.setMenuButtonState = (button, state, action) =>
    calls.push({ action, button, state });

  internals.setFormulaLatexRequestButtonState(
    staleButton,
    card,
    "formula",
    "check",
    "rerecognize",
  );

  assert.deepEqual(calls, [
    { action: "rerecognize", button: currentButton, state: "check" },
  ]);
  panel.dispose();
});

test("clears recognition loading state after the Reader document changes", async () => {
  const recognition = createDeferred<StoredFigureResult>();
  const source = { ...createResult("formula"), kind: "formula" as const };
  const panel = createPanel(async () => createPreview(), {
    onRerecognizeLatex: async () => await recognition.promise,
  });
  const oldDocument = {} as Document;
  const newDocument = {} as Document;
  const anchor = { ownerDocument: oldDocument } as HTMLButtonElement;
  let resets = 0;
  const internals = panel as unknown as {
    closeMenu(): void;
    document?: Document;
    rerecognizeFormulaLatex(
      anchor: HTMLButtonElement,
      result: StoredFigureResult,
    ): Promise<void>;
    resetFormulaLatexMenuButtons(resultID: string): void;
    results?: readonly StoredFigureResult[];
    setMenuButtonState(): void;
  };
  internals.document = oldDocument;
  internals.results = [source];
  internals.closeMenu = () => undefined;
  internals.setMenuButtonState = () => undefined;
  internals.resetFormulaLatexMenuButtons = () => resets++;

  const request = internals.rerecognizeFormulaLatex(anchor, source);
  internals.document = newDocument;
  recognition.resolve({ ...source, latex: "cloud" });
  await request;

  assert.equal(resets, 1);
  internals.document = undefined;
  panel.dispose();
});

test("passes displayed translations to single and bulk note exports", async () => {
  const first = createResult("first");
  const second = createResult("second");
  let bulkResults: readonly StoredFigureResult[] = [];
  let singleResult: StoredFigureResult | undefined;
  const panel = createPanel(async () => createPreview(), {
    onAddAllToNote: async (results) => {
      bulkResults = results;
    },
    onAddToNote: async (result) => {
      singleResult = result;
    },
  });
  const internals = panel as unknown as {
    addAllToNote(results: readonly StoredFigureResult[]): Promise<void>;
    addResultToNote(result: StoredFigureResult): Promise<void>;
    translatedComments: Map<string, string>;
    translationEnabled: boolean;
  };
  internals.translationEnabled = true;
  internals.translatedComments = new Map([[first.id, "translated first"]]);

  await internals.addAllToNote([first, second]);
  await internals.addResultToNote(first);

  assert.equal(bulkResults[0].comment, "translated first");
  assert.equal(bulkResults[1], second);
  assert.equal(singleResult?.comment, "translated first");
  assert.equal(first.comment, "first");
  panel.dispose();
});

function createPanel(
  onPrepareCorrection: FigureSidebarPanelOptions["onPrepareCorrection"],
  overrides: Partial<FigureSidebarPanelOptions> = {},
): FigureSidebarPanel {
  const options: FigureSidebarPanelOptions = {
    getCachedTranslations: async () => new Map(),
    getResults: async () => [],
    isAnalyzing: () => false,
    onAddAllToNote: async () => {},
    onAddToNote: async () => {},
    onAnalyze: () => {},
    onCacheTranslations: async () => new Map(),
    onCancelAnalysis: () => {},
    onClear: async () => {},
    onCopyImage: async () => {},
    onCopyLatex: async (result) => result,
    onCorrectRegion: async () => undefined,
    onEditComment: async () => undefined,
    onEditLatex: async () => undefined,
    onGoToPage: async () => {},
    onPrepareCorrection,
    onPrepareLatexEdit: async (result) =>
      result.latex
        ? {
            imageIdentity: `identity:${result.imagePath}`,
            latex: result.latex,
            result,
          }
        : undefined,
    onRemove: async () => {},
    onRerecognizeLatex: async (result) => result,
    onResultsDisplayed: () => {},
    onSaveImage: async () => {},
    onSyncAnnotations: async () => {},
    ownerWindow: globalThis as unknown as Window,
    reader: {} as PdfReader,
    ...overrides,
  };
  return new FigureSidebarPanel(options);
}

function createResult(id: string): StoredFigureResult {
  return {
    comment: id,
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

function createPreview(): ResultCorrectionPreview {
  return {
    detectedRect: [0.1, 0.1, 0.9, 0.9],
    imageURL: "data:image/jpeg;base64,",
    pageAspectRatio: 0.75,
    rect: [0.1, 0.1, 0.9, 0.9],
  };
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("Timed out waiting for sidebar formula state");
}
