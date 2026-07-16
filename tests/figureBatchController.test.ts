import * as assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  FigureBatchController,
  resolvePdfAttachments,
} from "../src/features/library/figureBatchController";
import type { FormulaLatexCoordinator } from "../src/services/formula/formulaLatexCoordinator";
import type { LayoutAnalyzer } from "../src/services/layout/layoutAnalyzer";
import type { FigureResultStore } from "../src/services/results/figureResultStore";
import { OperationCancelledError } from "../src/utils/cancellation";

const controllerSource = readFileSync(
  "src/features/library/figureBatchController.ts",
  "utf8",
);

test("keeps the PDF Figure menu enabled while a batch is running", () => {
  assert.doesNotMatch(controllerSource, /isDisabled/);
  assert.match(controllerSource, /batch-progress-already-running/);
});

test("resolves selected literature to unique PDFs in selection order", async () => {
  const firstPdf = makePdf(101);
  const secondPdf = makePdf(202);
  const selected = [
    makeRegularItem(1, firstPdf),
    firstPdf,
    makeRegularItem(2, false),
    makeRegularItem(3, secondPdf),
  ];

  assert.deepEqual(await resolvePdfAttachments(selected), [
    firstPdf,
    secondPdf,
  ]);
});

test("dispose aborts the active attachment analysis", async () => {
  const previousAddon = (globalThis as any).addon;
  const previousZotero = globalThis.Zotero;
  const previousZtoolkit = (globalThis as any).ztoolkit;
  const pdf = makePdf(101) as Zotero.Item & {
    getDisplayTitle(): string;
  };
  pdf.getDisplayTitle = () => "PDF";
  let observedSignal: AbortSignal | undefined;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const analyzer = {
    analyzeAttachment: async (
      _attachment: Zotero.Item,
      _progress: unknown,
      options: { signal?: AbortSignal },
    ) => {
      observedSignal = options.signal;
      markStarted();
      return new Promise((_resolve, reject) => {
        const abort = () => reject(new OperationCancelledError());
        if (options.signal?.aborted) abort();
        else options.signal?.addEventListener("abort", abort, { once: true });
      });
    },
  } as unknown as LayoutAnalyzer;
  const resultStore = {
    list: async () => assert.fail("cancelled analysis must not load results"),
  } as unknown as FigureResultStore;
  const formulaLatex = {
    recognizeAttachment: () =>
      assert.fail("cancelled analysis must not continue"),
  } as unknown as FormulaLatexCoordinator;

  class ProgressWindow {
    public changeLine(): this {
      return this;
    }
    public createLine(): this {
      return this;
    }
    public show(): this {
      return this;
    }
    public startCloseTimer(): this {
      return this;
    }
  }

  (globalThis as any).addon = {
    data: {
      locale: {
        current: {
          formatMessagesSync: ([{ id }]: Array<{ id: string }>) => [
            { value: id },
          ],
        },
      },
    },
  };
  (globalThis as any).ztoolkit = {
    Menu: { register: () => undefined, unregister: () => undefined },
    ProgressWindow,
  };
  globalThis.Zotero = {
    getActiveZoteroPane: () => ({ getSelectedItems: () => [pdf] }),
    getMainWindow: () => ({}),
    logError: (error: Error) => assert.fail(error.message),
  } as unknown as typeof Zotero;
  const controller = new FigureBatchController(
    analyzer,
    resultStore,
    formulaLatex,
  );

  try {
    controller.start();
    const running = (
      controller as unknown as {
        run(action: "analyze"): Promise<void>;
      }
    ).run("analyze");
    await started;
    controller.dispose();
    await running;

    assert.equal(observedSignal?.aborted, true);
  } finally {
    controller.dispose();
    (globalThis as any).addon = previousAddon;
    globalThis.Zotero = previousZotero;
    (globalThis as any).ztoolkit = previousZtoolkit;
  }
});

function makePdf(id: number): Zotero.Item {
  return {
    id,
    isPDFAttachment: () => true,
    isRegularItem: () => false,
  } as unknown as Zotero.Item;
}

function makeRegularItem(
  id: number,
  attachment: Zotero.Item | false,
): Zotero.Item {
  return {
    getBestAttachment: async () => attachment,
    id,
    isPDFAttachment: () => false,
    isRegularItem: () => true,
  } as unknown as Zotero.Item;
}
