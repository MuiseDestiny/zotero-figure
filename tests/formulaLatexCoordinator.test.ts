import * as assert from "node:assert/strict";
import test from "node:test";
import type { FormulaLatexPlatform } from "../src/platform/zotero/formulaLatex";
import { FormulaLatexCoordinator } from "../src/services/formula/formulaLatexCoordinator";
import type {
  FormulaRecognitionInput,
  StoredFigureResult,
} from "../src/services/results/figureResultStore";
import { OperationCancelledError } from "../src/utils/cancellation";

test("converts uncached formulae across libraries with bounded failures", async () => {
  const first = attachment(1, "FIRST");
  const second = attachment(2, "SECOND");
  const results = new Map<string, StoredFigureResult[]>([
    [
      first.key,
      [
        formula("formula-1", 1),
        formula("formula-2", 2),
        { ...formula("cached", 9), latex: "x" },
        { ...formula("figure", 8), kind: "figure" },
      ],
    ],
    [second.key, [formula("formula-3", 3)]],
  ]);
  const errors: Error[] = [];
  const updates: string[] = [];
  let active = 0;
  let maximumActive = 0;
  const platform: FormulaLatexPlatform = {
    getAttachment: async (libraryID, key) =>
      libraryID === 1 && key === "MISSING"
        ? false
        : libraryID === 1
          ? first
          : second,
    listLibraries: () => [{ id: 1 }, { id: 2 }],
    logError: (error) => errors.push(error),
  };
  const store = {
    list: async (item: Zotero.Item) => results.get(item.key) ?? [],
    listIndexedAttachmentKeys: async (libraryID: number) =>
      libraryID === 1 ? ["FIRST", "MISSING"] : ["SECOND"],
    readFormulaLatexState: async () => undefined,
    readFormulaRecognitionInput: async (
      item: Zotero.Item,
      resultID: string,
    ) => {
      const result = results.get(item.key)?.find(({ id }) => id === resultID);
      return result ? recognitionInput(result) : undefined;
    },
    updateFormulaLatex: async (
      item: Zotero.Item,
      resultID: string,
      latex: string,
    ) => {
      const result = results.get(item.key)?.find(({ id }) => id === resultID);
      if (!result) return undefined;
      const updated = { ...result, latex };
      updates.push(resultID);
      return updated;
    },
  };
  const coordinator = new FormulaLatexCoordinator(store, {
    getApiKey: () => "key",
    platform,
    recognize: async (image) => {
      active++;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 0));
      active--;
      if (image[0] === 3) throw new Error("request failed");
      return `x_${image[0]}`;
    },
  });
  const progress: Array<{
    completed: number;
    phase: string;
    total: number;
  }> = [];

  const summary = await coordinator.recognizeStoredFormulae((update) =>
    progress.push(update),
  );

  assert.deepEqual(summary, { failed: 1, succeeded: 2, total: 3 });
  assert.deepEqual(updates.sort(), ["formula-1", "formula-2"]);
  assert.equal(maximumActive, 2);
  assert.equal(errors.length, 1);
  assert.equal(progress[0].phase, "scanning");
  assert.deepEqual(progress[1], {
    completed: 0,
    failed: 0,
    phase: "recognizing",
    succeeded: 0,
    total: 3,
  });
  assert.equal(progress.at(-1)?.completed, 3);
});

test("forced recognition overwrites cached LaTeX and publishes the update", async () => {
  const item = attachment(1, "FIRST");
  const cached = { ...formula("cached", 1), latex: "old" };
  const updates: string[] = [];
  const store = {
    list: async () => [cached],
    listIndexedAttachmentKeys: async () => [],
    readFormulaLatexState: async () => undefined,
    readFormulaRecognitionInput: async () => recognitionInput(cached),
    updateFormulaLatex: async (
      _item: Zotero.Item,
      _resultID: string,
      latex: string,
    ) => ({ ...cached, latex }),
  };
  let calls = 0;
  const coordinator = new FormulaLatexCoordinator(store, {
    getApiKey: () => "key",
    platform: {
      getAttachment: async () => false,
      listLibraries: () => [],
      logError: (error) => assert.fail(error.message),
    },
    recognize: async () => {
      calls++;
      return "new";
    },
  });
  coordinator.subscribe(({ result }) => updates.push(result.latex ?? ""));

  assert.equal((await coordinator.recognize(item, cached)).latex, "old");
  assert.equal(calls, 0);
  assert.equal(
    (await coordinator.recognize(item, cached, { force: true })).latex,
    "new",
  );
  assert.equal(calls, 1);
  assert.deepEqual(updates, ["new"]);
});

test("does not overwrite a manual edit made during cloud recognition", async () => {
  const item = attachment(1, "FIRST");
  let current = { ...formula("cached", 1), latex: "old" };
  let finishRecognition!: (latex: string) => void;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const recognition = new Promise<string>((resolve) => {
    finishRecognition = resolve;
  });
  const store = {
    list: async () => [current],
    listIndexedAttachmentKeys: async () => [],
    readFormulaLatexState: async () => undefined,
    readFormulaRecognitionInput: async () => recognitionInput(current),
    updateFormulaLatex: async (
      _item: Zotero.Item,
      _resultID: string,
      latex: string,
      _expectedImageIdentity?: string,
      expectedLatex?: string | null,
    ) => {
      if (
        expectedLatex !== undefined &&
        (current.latex ?? null) !== expectedLatex
      ) {
        throw new Error("Formula LaTeX changed during recognition");
      }
      current = { ...current, latex };
      return current;
    },
  };
  const coordinator = new FormulaLatexCoordinator(store, {
    getApiKey: () => "key",
    platform: {
      getAttachment: async () => false,
      listLibraries: () => [],
      logError: (error) => assert.fail(error.message),
    },
    recognize: async () => {
      markStarted();
      return recognition;
    },
  });

  const cloudUpdate = coordinator.recognize(item, current, { force: true });
  await started;
  await coordinator.update(item, current.id, "manual");
  finishRecognition("cloud");

  await assert.rejects(cloudUpdate, /LaTeX changed during recognition/);
  assert.equal(current.latex, "manual");
});

test("does not save an editor snapshot after the formula image changes", async () => {
  const item = attachment(1, "FIRST");
  let current = { ...formula("cached", 1), latex: "old" };
  let imageIdentity = "old-image";
  const coordinator = new FormulaLatexCoordinator(
    {
      list: async () => [current],
      listIndexedAttachmentKeys: async () => [],
      readFormulaLatexState: async () => ({
        imageIdentity,
        latex: current.latex,
        result: current,
      }),
      readFormulaRecognitionInput: async () => recognitionInput(current),
      updateFormulaLatex: async (
        _item,
        _resultID,
        latex,
        expectedImageIdentity,
        expectedLatex,
      ) => {
        if (expectedImageIdentity !== imageIdentity) {
          throw new Error("Formula image changed during LaTeX editing");
        }
        if (expectedLatex !== current.latex) {
          throw new Error("Formula LaTeX changed during editing");
        }
        current = { ...current, latex };
        return current;
      },
    },
    { platform: emptyPlatform() },
  );

  const edit = await coordinator.prepareEdit(item, current.id);
  assert.ok(edit);
  imageIdentity = "new-image";

  await assert.rejects(
    coordinator.update(item, current.id, "manual", edit),
    /image changed/,
  );
  assert.equal(current.latex, "old");
});

test("dispose cancels active recognition as OperationCancelledError", async () => {
  const item = attachment(1, "FIRST");
  const result = formula("formula", 1);
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const coordinator = new FormulaLatexCoordinator(
    {
      list: async () => [result],
      listIndexedAttachmentKeys: async () => [],
      readFormulaLatexState: async () => undefined,
      readFormulaRecognitionInput: async () => recognitionInput(result),
      updateFormulaLatex: async () => assert.fail("cancelled result was saved"),
    },
    {
      getApiKey: () => "key",
      platform: {
        getAttachment: async () => false,
        listLibraries: () => [],
        logError: (error) => assert.fail(error.message),
      },
      recognize: async (_image, _key, options) => {
        markStarted();
        return new Promise<string>((_resolve, reject) => {
          const abort = () =>
            reject(new DOMException("Request aborted", "AbortError"));
          if (options?.signal?.aborted) abort();
          else
            options?.signal?.addEventListener("abort", abort, { once: true });
        });
      },
    },
  );

  const pending = coordinator.recognize(item, result);
  await started;
  coordinator.dispose();

  await assert.rejects(pending, OperationCancelledError);
});

test("rejects cloud output when the formula image changes at the same geometry", async () => {
  const item = attachment(1, "FIRST");
  const result = formula("formula", 1);
  let imageIdentity = "old-image";
  let finishRecognition!: (latex: string) => void;
  let markStarted!: () => void;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const recognition = new Promise<string>((resolve) => {
    finishRecognition = resolve;
  });
  const coordinator = new FormulaLatexCoordinator(
    {
      list: async () => [result],
      listIndexedAttachmentKeys: async () => [],
      readFormulaLatexState: async () => undefined,
      readFormulaRecognitionInput: async () => ({
        ...recognitionInput(result),
        imageIdentity,
      }),
      updateFormulaLatex: async (
        _item,
        _resultID,
        _latex,
        expectedImageIdentity,
      ) => {
        if (expectedImageIdentity !== imageIdentity) {
          throw new Error("Formula image changed during LaTeX recognition");
        }
        return { ...result, latex: "cloud" };
      },
    },
    {
      getApiKey: () => "key",
      platform: {
        getAttachment: async () => false,
        listLibraries: () => [],
        logError: (error) => assert.fail(error.message),
      },
      recognize: async () => {
        markStarted();
        return recognition;
      },
    },
  );

  const pending = coordinator.recognize(item, result);
  await started;
  imageIdentity = "new-image";
  finishRecognition("cloud");

  await assert.rejects(pending, /image changed/);
});

test("does not overwrite a manual edit made while forced recognition is queued", async () => {
  const item = attachment(1, "FIRST");
  const first = formula("first", 1);
  const second = formula("second", 2);
  const target = { ...formula("target", 3), latex: "old" };
  const current = new Map(
    [first, second, target].map((result) => [result.id, result]),
  );
  const blockers = new Map([
    [1, createDeferred<string>()],
    [2, createDeferred<string>()],
  ]);
  const started = new Set<number>();
  const coordinator = new FormulaLatexCoordinator(
    {
      list: async () => [...current.values()],
      listIndexedAttachmentKeys: async () => [],
      readFormulaLatexState: async () => undefined,
      readFormulaRecognitionInput: async (_item, resultID) => {
        const result = current.get(resultID);
        return result ? recognitionInput(result) : undefined;
      },
      updateFormulaLatex: async (
        _item,
        resultID,
        latex,
        _expectedImageIdentity,
        expectedLatex,
      ) => {
        const result = current.get(resultID);
        if (!result) return undefined;
        if (
          expectedLatex !== undefined &&
          (result.latex ?? null) !== expectedLatex
        ) {
          throw new Error("Formula LaTeX changed during recognition");
        }
        const updated = { ...result, latex };
        current.set(resultID, updated);
        return updated;
      },
    },
    {
      getApiKey: () => "key",
      platform: emptyPlatform(),
      recognize: async (image) => {
        const imageNumber = image[0];
        started.add(imageNumber);
        return (await blockers.get(imageNumber)?.promise) ?? "cloud";
      },
    },
  );

  const firstRequest = coordinator.recognize(item, first);
  const secondRequest = coordinator.recognize(item, second);
  await waitFor(() => started.size === 2);
  const queued = coordinator.recognize(item, target, { force: true });
  await coordinator.update(item, target.id, "manual");
  blockers.get(1)!.resolve("first-latex");

  await assert.rejects(queued, /LaTeX changed during recognition/);
  assert.equal(current.get(target.id)?.latex, "manual");
  blockers.get(2)!.resolve("second-latex");
  await Promise.all([firstRequest, secondRequest]);
});

test("cancels one shared recognition waiter without aborting the other", async () => {
  const item = attachment(1, "FIRST");
  const result = formula("shared", 1);
  const recognition = createDeferred<string>();
  let recognitionSignal: AbortSignal | undefined;
  const coordinator = new FormulaLatexCoordinator(
    {
      list: async () => [result],
      listIndexedAttachmentKeys: async () => [],
      readFormulaLatexState: async () => undefined,
      readFormulaRecognitionInput: async () => recognitionInput(result),
      updateFormulaLatex: async (_item, _id, latex) => ({ ...result, latex }),
    },
    {
      getApiKey: () => "key",
      platform: emptyPlatform(),
      recognize: async (_image, _key, options) => {
        recognitionSignal = options?.signal;
        return await recognition.promise;
      },
    },
  );

  const original = coordinator.recognize(item, result);
  await waitFor(() => recognitionSignal !== undefined);
  const controller = new AbortController();
  const joined = coordinator.recognize(item, result, {
    signal: controller.signal,
  });
  controller.abort();

  await assert.rejects(joined, OperationCancelledError);
  assert.equal(recognitionSignal?.aborted, false);
  recognition.resolve("shared-latex");
  assert.equal((await original).latex, "shared-latex");
});

test("aborts recognition when its final waiter is cancelled", async () => {
  const item = attachment(1, "FIRST");
  const result = formula("only-waiter", 1);
  let recognitionSignal: AbortSignal | undefined;
  const coordinator = new FormulaLatexCoordinator(
    {
      list: async () => [result],
      listIndexedAttachmentKeys: async () => [],
      readFormulaLatexState: async () => undefined,
      readFormulaRecognitionInput: async () => recognitionInput(result),
      updateFormulaLatex: async () => assert.fail("cancelled output was saved"),
    },
    {
      getApiKey: () => "key",
      platform: emptyPlatform(),
      recognize: async (_image, _key, options) => {
        recognitionSignal = options?.signal;
        return await new Promise<string>((_resolve, reject) => {
          const abort = () =>
            reject(new DOMException("Request aborted", "AbortError"));
          if (options?.signal?.aborted) abort();
          else
            options?.signal?.addEventListener("abort", abort, { once: true });
        });
      },
    },
  );
  const controller = new AbortController();
  const request = coordinator.recognize(item, result, {
    signal: controller.signal,
  });
  await waitFor(() => recognitionSignal !== undefined);

  controller.abort();

  await assert.rejects(request, OperationCancelledError);
  assert.equal(recognitionSignal?.aborted, true);
});

test("publishes stored formula state when automatic recognition is disabled", async () => {
  const item = attachment(1, "FIRST");
  const empty = formula("empty", 1);
  const cached = { ...formula("cached", 2), latex: "x" };
  const figure = { ...formula("figure", 3), kind: "figure" as const };
  const published: string[] = [];
  const coordinator = new FormulaLatexCoordinator(
    {
      list: async () => [empty, cached, figure],
      listIndexedAttachmentKeys: async () => [],
      readFormulaLatexState: async () => undefined,
      readFormulaRecognitionInput: async () =>
        assert.fail("automatic recognition is disabled"),
      updateFormulaLatex: async () =>
        assert.fail("automatic recognition is disabled"),
    },
    {
      isAutoRecognitionEnabled: () => false,
      platform: emptyPlatform(),
      recognize: async () => assert.fail("automatic recognition is disabled"),
    },
  );
  coordinator.subscribe(({ result }) => published.push(result.id));

  coordinator.recognizeAttachment(item);
  await waitFor(() => published.length === 2);

  assert.deepEqual(published, ["empty", "cached"]);
});

function attachment(libraryID: number, key: string): Zotero.Item {
  return {
    isPDFAttachment: () => true,
    key,
    libraryID,
  } as unknown as Zotero.Item;
}

function formula(id: string, imageNumber: number): StoredFigureResult {
  return {
    comment: id,
    id,
    imageFile: `images/${id}.png`,
    imagePath: `/images/${imageNumber}.png`,
    kind: "formula",
    pageIndex: 0,
    pageLabel: "1",
    rect: [0, 0, 1, 1],
    tag: "Formula 1",
  };
}

function recognitionInput(result: StoredFigureResult): FormulaRecognitionInput {
  return {
    image: Uint8Array.of(Number(result.imagePath.match(/(\d+)\.png$/)?.[1])),
    imageIdentity: `identity:${result.imagePath}`,
    latex: result.latex ?? null,
    result,
  };
}

function emptyPlatform(): FormulaLatexPlatform {
  return {
    getAttachment: async () => false,
    listLibraries: () => [],
    logError: (error) => assert.fail(error.message),
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
  throw new Error("Timed out waiting for formula recognition state");
}
