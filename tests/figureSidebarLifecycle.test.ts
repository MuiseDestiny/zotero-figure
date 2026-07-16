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

function createPanel(
  onPrepareCorrection: FigureSidebarPanelOptions["onPrepareCorrection"],
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
    onCorrectRegion: async () => undefined,
    onEditComment: async () => undefined,
    onGoToPage: async () => {},
    onPrepareCorrection,
    onRemove: async () => {},
    onSaveImage: async () => {},
    onSyncAnnotations: async () => {},
    ownerWindow: globalThis as unknown as Window,
    reader: {} as PdfReader,
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
    rect: [0.1, 0.1, 0.9, 0.9],
  };
}
