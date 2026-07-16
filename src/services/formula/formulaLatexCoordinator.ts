import type {
  FormulaLatexState,
  FormulaRecognitionInput,
  StoredFigureResult,
} from "../results/figureResultStore";
import type { FormulaLatexPlatform } from "../../platform/zotero/formulaLatex";
import { createZoteroFormulaLatexPlatform } from "../../platform/zotero/formulaLatex";
import { AsyncPermitPool } from "../concurrency/asyncPermitPool";
import { getPref } from "../../utils/prefs";
import {
  isCancellationError,
  OperationCancelledError,
  throwIfAborted,
} from "../../utils/cancellation";
import { recognizeFormulaLatex } from "./formulaLatexService";

const FORMULA_REQUEST_CONCURRENCY = 2;

export interface FormulaLatexUpdate {
  attachmentKey: string;
  libraryID: number;
  result: StoredFigureResult;
}

type FormulaLatexListener = (update: FormulaLatexUpdate) => void;

interface ActiveFormulaRecognition {
  controller: AbortController;
  promise: Promise<StoredFigureResult>;
  settled: boolean;
  waiters: number;
}

interface FormulaLatexResultStore {
  list(item: Zotero.Item): Promise<StoredFigureResult[]>;
  listIndexedAttachmentKeys(libraryID: number): Promise<string[]>;
  readFormulaRecognitionInput(
    item: Zotero.Item,
    resultID: string,
    signal?: AbortSignal,
  ): Promise<FormulaRecognitionInput | undefined>;
  readFormulaLatexState(
    item: Zotero.Item,
    resultID: string,
  ): Promise<FormulaLatexState | undefined>;
  updateFormulaLatex(
    item: Zotero.Item,
    resultID: string,
    latex: string,
    expectedImageIdentity?: string,
    expectedLatex?: string | null,
  ): Promise<StoredFigureResult | undefined>;
}

export interface FormulaLatexBatchProgress {
  completed: number;
  failed: number;
  phase: "recognizing" | "scanning";
  succeeded: number;
  total: number;
}

export interface FormulaLatexBatchSummary {
  failed: number;
  succeeded: number;
  total: number;
}

export interface FormulaLatexCoordinatorOptions {
  getApiKey?(): string;
  isAutoRecognitionEnabled?(): boolean;
  platform?: FormulaLatexPlatform;
  recognize?: typeof recognizeFormulaLatex;
}

export interface FormulaLatexRecognitionOptions {
  force?: boolean;
  signal?: AbortSignal;
}

export interface FormulaLatexEditSnapshot extends FormulaLatexState {
  latex: string;
}

export class FormulaLatexCoordinator {
  private readonly active = new Map<string, ActiveFormulaRecognition>();
  private readonly getApiKey: () => string;
  private readonly isAutoEnabled: () => boolean;
  private readonly listeners = new Set<FormulaLatexListener>();
  private readonly lifecycleController = new AbortController();
  private readonly permits = new AsyncPermitPool(FORMULA_REQUEST_CONCURRENCY);
  private readonly platform: FormulaLatexPlatform;
  private readonly recognizer: typeof recognizeFormulaLatex;

  constructor(
    private readonly resultStore: FormulaLatexResultStore,
    options: FormulaLatexCoordinatorOptions = {},
  ) {
    this.platform = options.platform ?? createZoteroFormulaLatexPlatform();
    this.recognizer = options.recognize ?? recognizeFormulaLatex;
    this.getApiKey =
      options.getApiKey ?? (() => getPref("siliconFlowApiKey") ?? "");
    this.isAutoEnabled =
      options.isAutoRecognitionEnabled ?? isAutoRecognitionEnabled;
  }

  public subscribe(listener: FormulaLatexListener): () => void {
    throwIfAborted(this.lifecycleController.signal);
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public dispose(): void {
    if (this.lifecycleController.signal.aborted) return;
    this.lifecycleController.abort();
    this.listeners.clear();
  }

  public recognizeAttachment(item: Zotero.Item): void {
    if (this.lifecycleController.signal.aborted) return;
    void this.resultStore
      .list(item)
      .then((results) => {
        if (this.lifecycleController.signal.aborted) return;
        for (const result of results) {
          if (result.kind !== "formula") continue;
          this.notify(item, result);
          if (!result.latex && this.isAutoEnabled()) {
            void this.recognize(item, result).catch((error) => {
              if (!isCancellationError(error)) {
                this.platform.logError(toError(error));
              }
            });
          }
        }
      })
      .catch((error) => {
        if (!isCancellationError(error)) this.platform.logError(toError(error));
      });
  }

  public async recognizeStoredFormulae(
    onProgress: (progress: FormulaLatexBatchProgress) => void = () => {},
    signal?: AbortSignal,
  ): Promise<FormulaLatexBatchSummary> {
    throwIfAborted(signal);
    throwIfAborted(this.lifecycleController.signal);
    this.reportBatchProgress(onProgress, {
      completed: 0,
      failed: 0,
      phase: "scanning",
      succeeded: 0,
      total: 0,
    });
    const targets = await this.listStoredFormulaeWithoutLatex(signal);
    throwIfAborted(signal);
    throwIfAborted(this.lifecycleController.signal);
    const summary: FormulaLatexBatchSummary = {
      failed: 0,
      succeeded: 0,
      total: targets.length,
    };
    this.reportBatchProgress(onProgress, {
      completed: 0,
      ...summary,
      phase: "recognizing",
    });
    let nextIndex = 0;
    const workers = Array.from(
      { length: Math.min(FORMULA_REQUEST_CONCURRENCY, targets.length) },
      async () => {
        while (nextIndex < targets.length) {
          throwIfAborted(signal);
          const target = targets[nextIndex++];
          try {
            await this.recognize(target.item, target.result, { signal });
            throwIfAborted(signal);
            summary.succeeded++;
          } catch (error) {
            if (signal?.aborted || isCancellationError(error)) {
              throw new OperationCancelledError();
            }
            summary.failed++;
            this.platform.logError(toError(error));
          }
          this.reportBatchProgress(onProgress, {
            completed: summary.succeeded + summary.failed,
            ...summary,
            phase: "recognizing",
          });
        }
      },
    );
    await Promise.all(workers);
    throwIfAborted(signal);
    throwIfAborted(this.lifecycleController.signal);
    return summary;
  }

  public async recognize(
    item: Zotero.Item,
    result: StoredFigureResult,
    options: FormulaLatexRecognitionOptions = {},
  ): Promise<StoredFigureResult> {
    throwIfAborted(options.signal);
    throwIfAborted(this.lifecycleController.signal);
    if (result.kind !== "formula") {
      throw new Error("LaTeX recognition requires a formula result");
    }
    if (result.latex && !options.force) return result;
    const requestKey = `${item.libraryID}:${item.key}:${result.id}`;
    let active = this.active.get(requestKey);
    if (!active) {
      active = this.startRecognition(
        item,
        result,
        requestKey,
        options.force === true,
      );
    }
    return this.waitForRecognition(active, options.signal);
  }

  public async update(
    item: Zotero.Item,
    resultID: string,
    latex: string,
    expected?: FormulaLatexEditSnapshot,
  ): Promise<StoredFigureResult | undefined> {
    throwIfAborted(this.lifecycleController.signal);
    const updated = await this.resultStore.updateFormulaLatex(
      item,
      resultID,
      latex,
      expected?.imageIdentity,
      expected?.latex,
    );
    if (updated) this.notify(item, updated);
    return updated;
  }

  public async prepareEdit(
    item: Zotero.Item,
    resultID: string,
  ): Promise<FormulaLatexEditSnapshot | undefined> {
    throwIfAborted(this.lifecycleController.signal);
    const state = await this.resultStore.readFormulaLatexState(item, resultID);
    throwIfAborted(this.lifecycleController.signal);
    return state?.latex ? { ...state, latex: state.latex } : undefined;
  }

  public publish(item: Zotero.Item, result: StoredFigureResult): void {
    this.notify(item, result);
  }

  private startRecognition(
    item: Zotero.Item,
    result: StoredFigureResult,
    requestKey: string,
    force: boolean,
  ): ActiveFormulaRecognition {
    const controller = new AbortController();
    const abort = () => controller.abort();
    this.lifecycleController.signal.addEventListener("abort", abort, {
      once: true,
    });
    if (this.lifecycleController.signal.aborted) controller.abort();
    const operation = this.runRecognition(
      item,
      result,
      force,
      result.latex ?? null,
      controller.signal,
    );
    const promise = operation.finally(() => {
      this.lifecycleController.signal.removeEventListener("abort", abort);
    });
    const active: ActiveFormulaRecognition = {
      controller,
      promise,
      settled: false,
      waiters: 0,
    };
    this.active.set(requestKey, active);
    const finish = () => {
      active.settled = true;
      if (this.active.get(requestKey) === active)
        this.active.delete(requestKey);
    };
    void promise.then(finish, finish);
    return active;
  }

  private async runRecognition(
    item: Zotero.Item,
    result: StoredFigureResult,
    force: boolean,
    expectedLatex: string | null,
    signal: AbortSignal,
  ): Promise<StoredFigureResult> {
    let release: (() => void) | undefined;
    try {
      release = await this.permits.acquire(signal);
      const input = await this.resultStore.readFormulaRecognitionInput(
        item,
        result.id,
        signal,
      );
      if (!input) throw new Error("Formula result no longer exists");
      if (input.latex && !force) return input.result;
      if (force && input.latex !== expectedLatex) {
        throw new Error("Formula LaTeX changed during recognition");
      }
      throwIfAborted(signal);
      const latex = await this.recognizer(input.image, this.getApiKey(), {
        signal,
      });
      throwIfAborted(signal);
      const updated = await this.resultStore.updateFormulaLatex(
        item,
        result.id,
        latex,
        input.imageIdentity,
        expectedLatex,
      );
      if (!updated) throw new Error("Formula result no longer exists");
      this.notify(item, updated);
      return updated;
    } catch (error) {
      if (signal.aborted || isCancellationError(error)) {
        throw new OperationCancelledError();
      }
      throw error;
    } finally {
      release?.();
    }
  }

  private waitForRecognition(
    active: ActiveFormulaRecognition,
    signal?: AbortSignal,
  ): Promise<StoredFigureResult> {
    throwIfAborted(signal);
    active.waiters++;
    return new Promise<StoredFigureResult>((resolve, reject) => {
      let waiting = true;
      const finish = (): boolean => {
        if (!waiting) return false;
        waiting = false;
        signal?.removeEventListener("abort", abort);
        active.waiters--;
        return true;
      };
      const abort = () => {
        if (!finish()) return;
        reject(new OperationCancelledError());
        if (!active.settled && active.waiters === 0) active.controller.abort();
      };
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      active.promise.then(
        (updated) => {
          if (finish()) resolve(updated);
        },
        (error) => {
          if (finish()) reject(error);
        },
      );
    });
  }

  private async listStoredFormulaeWithoutLatex(
    signal?: AbortSignal,
  ): Promise<Array<{ item: Zotero.Item; result: StoredFigureResult }>> {
    const targets: Array<{ item: Zotero.Item; result: StoredFigureResult }> =
      [];
    for (const { id: libraryID } of this.platform.listLibraries()) {
      throwIfAborted(signal);
      throwIfAborted(this.lifecycleController.signal);
      let keys: string[];
      try {
        keys = await this.resultStore.listIndexedAttachmentKeys(libraryID);
        throwIfAborted(signal);
        throwIfAborted(this.lifecycleController.signal);
      } catch (error) {
        if (
          signal?.aborted ||
          this.lifecycleController.signal.aborted ||
          isCancellationError(error)
        ) {
          throw new OperationCancelledError();
        }
        this.platform.logError(toError(error));
        continue;
      }
      for (const key of keys) {
        throwIfAborted(signal);
        throwIfAborted(this.lifecycleController.signal);
        try {
          const item = await this.platform.getAttachment(libraryID, key);
          throwIfAborted(signal);
          throwIfAborted(this.lifecycleController.signal);
          if (!item || !item.isPDFAttachment()) continue;
          const results = await this.resultStore.list(item);
          throwIfAborted(signal);
          throwIfAborted(this.lifecycleController.signal);
          for (const result of results) {
            if (result.kind === "formula" && !result.latex) {
              targets.push({ item, result });
            }
          }
        } catch (error) {
          if (
            signal?.aborted ||
            this.lifecycleController.signal.aborted ||
            isCancellationError(error)
          ) {
            throw new OperationCancelledError();
          }
          this.platform.logError(toError(error));
        }
      }
    }
    return targets;
  }

  private reportBatchProgress(
    listener: (progress: FormulaLatexBatchProgress) => void,
    progress: FormulaLatexBatchProgress,
  ): void {
    try {
      listener(progress);
    } catch (error) {
      this.platform.logError(toError(error));
    }
  }

  private notify(item: Zotero.Item, result: StoredFigureResult): void {
    const update: FormulaLatexUpdate = {
      attachmentKey: item.key,
      libraryID: item.libraryID,
      result,
    };
    for (const listener of this.listeners) {
      try {
        listener(update);
      } catch (error) {
        this.platform.logError(toError(error));
      }
    }
  }
}

function isAutoRecognitionEnabled(): boolean {
  return (
    getPref("autoRecognizeFormula") === true &&
    getPref("siliconFlowApiKeyValidated") === true &&
    Boolean(getPref("siliconFlowApiKey")?.trim())
  );
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
