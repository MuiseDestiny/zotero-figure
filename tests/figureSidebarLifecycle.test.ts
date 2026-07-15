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
  openRegionEditor(result: StoredFigureResult): Promise<void>;
  pinnedCards: Map<
    string,
    { dispose(): void; element: Pick<HTMLElement, "contains"> }
  >;
  reconcilePinnedCards(results: readonly StoredFigureResult[]): void;
}

test("ignores superseded and detached region preview requests", async () => {
  const first = createDeferred<ResultCorrectionPreview>();
  const second = createDeferred<ResultCorrectionPreview>();
  const previews = new Map([
    ["first", first.promise],
    ["second", second.promise],
  ]);
  const panel = createPanel(
    (result) => previews.get(result.id) as Promise<ResultCorrectionPreview>,
  );
  const internals = panel as unknown as PanelInternals;

  const firstRequest = internals.openRegionEditor(createResult("first"));
  const secondRequest = internals.openRegionEditor(createResult("second"));
  first.resolve(createPreview());
  await firstRequest;

  panel.dispose();
  second.resolve(createPreview());
  await secondRequest;
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

  internals.reconcilePinnedCards([createResult("retained")]);

  assert.equal(staleDisposals, 1);
  assert.equal(retainedDisposals, 0);
  assert.deepEqual([...internals.pinnedCards.keys()], ["retained"]);
  panel.dispose();
  assert.equal(retainedDisposals, 1);
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
