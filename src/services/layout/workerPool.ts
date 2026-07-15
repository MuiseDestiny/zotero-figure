import type { LayoutElement } from "../../domain/layout";
import {
  OperationCancelledError,
  throwIfAborted,
} from "../../utils/cancellation";

export interface WorkerPoolDependencies {
  createWorker: () => Worker;
  expectedModelHash: string;
  expectedModelSize: number;
  loadModelBytes?: () => Promise<ArrayBuffer>;
  log?: (...values: unknown[]) => void;
  modelBytes?: ArrayBuffer;
  modelURL: string;
  modelName: string;
  onDiagnostics?: (diagnostics: LayoutWorkerDiagnostics) => void;
  onTiming?: (timing: LayoutWorkerTiming) => void;
  quantized: boolean;
  resourceBaseURL: string;
  taskTimeoutMs?: number;
  wasmURL: string;
  workerCount?: number;
}

export interface LayoutDetectionTimings {
  decodeMs: number;
  inferenceMs: number;
  postprocessMs: number;
  preprocessMs: number;
  queueMs: number;
  totalMs: number;
}

export interface LayoutDetectionResult {
  elements: LayoutElement[];
  timings: LayoutDetectionTimings;
}

export interface LayoutWorkerDiagnostics {
  configuredInferenceThreads: number;
  crossOriginIsolated: boolean;
  modelSource: "bytes" | "url";
  requestedInferenceThreads: number;
  selectiveOutputEnabled: boolean;
  sharedArrayBufferAvailable: boolean;
}

export interface LayoutWorkerTiming extends LayoutDetectionTimings {
  pageIndex: number;
  taskID: number;
}

interface WorkerSlot {
  busy: boolean;
  index: number;
  worker: Worker;
}

interface DetectionTask {
  abort?: () => void;
  imageData: ArrayBuffer;
  pageIndex: number;
  reject: (error: Error) => void;
  resolve: (result: LayoutDetectionResult) => void;
  settled: boolean;
  signal?: AbortSignal;
  taskID: number;
  queuedAt: number;
  queueMs?: number;
}

interface ActiveTask {
  slot: WorkerSlot;
  task: DetectionTask;
  timeoutID: ReturnType<typeof setTimeout>;
}

interface WorkerResponse {
  diagnostics?: LayoutWorkerDiagnostics;
  error?: string;
  inferenceThreads?: number;
  message?: string;
  pageIndex?: number;
  results?: LayoutElement[];
  taskID?: number;
  timings?: Partial<LayoutDetectionTimings>;
  type: "ERROR" | "READY" | "RESULT";
}

const DEFAULT_WORKER_COUNT = 1;
const DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1_000;
const INITIALIZATION_TIMEOUT_MS = 2 * 60 * 1_000;

export class LayoutWorkerPool {
  private readonly activeTasks = new Map<number, ActiveTask>();
  private readonly initializationRejectors = new Set<(error: Error) => void>();
  private disposed = false;
  private disposedError?: Error;
  private nextTaskID = 1;
  private nextWorkerIndex = 0;
  private initialModelBytes?: ArrayBuffer;
  private readonly queue: DetectionTask[] = [];
  private readyPromise?: Promise<void>;
  private readonly slots: WorkerSlot[] = [];
  private readonly workers = new Set<Worker>();

  constructor(private readonly dependencies: WorkerPoolDependencies) {
    this.initialModelBytes = dependencies.modelBytes;
  }

  public async detect(
    imageData: ArrayBuffer,
    pageIndex: number,
    signal?: AbortSignal,
  ): Promise<LayoutElement[]> {
    return (await this.detectWithTiming(imageData, pageIndex, signal)).elements;
  }

  public async detectWithTiming(
    imageData: ArrayBuffer,
    pageIndex: number,
    signal?: AbortSignal,
  ): Promise<LayoutDetectionResult> {
    this.assertActive();
    throwIfAborted(signal);
    await waitForPromise(this.ensureReady(), signal);
    this.assertActive();
    throwIfAborted(signal);

    return new Promise<LayoutDetectionResult>((resolve, reject) => {
      const task: DetectionTask = {
        imageData,
        pageIndex,
        queuedAt: Date.now(),
        reject,
        resolve,
        settled: false,
        signal,
        taskID: this.nextTaskID++,
      };
      task.abort = () => this.cancelTask(task);
      signal?.addEventListener("abort", task.abort, { once: true });
      this.queue.push(task);
      this.dispatchQueuedTasks();
    });
  }

  public async prepare(signal?: AbortSignal): Promise<void> {
    this.assertActive();
    throwIfAborted(signal);
    await waitForPromise(this.ensureReady(), signal);
    this.assertActive();
  }

  public get isDisposed(): boolean {
    return this.disposed;
  }

  public dispose(
    error: Error = new Error("Layout worker pool was disposed"),
  ): void {
    this.shutdown(error);
  }

  private async ensureReady(): Promise<void> {
    this.readyPromise ??= this.initialize();
    return this.readyPromise;
  }

  private async initialize(): Promise<void> {
    const { workerCount = DEFAULT_WORKER_COUNT } = this.dependencies;
    if (!Number.isInteger(workerCount) || workerCount < 1) {
      throw new Error("workerCount must be a positive integer");
    }

    try {
      const slots = await Promise.all(
        Array.from({ length: workerCount }, () => this.createWorkerSlot()),
      );
      this.assertActive();
      this.slots.push(...slots);
      this.dependencies.log?.(`Initialized ${slots.length} layout workers`);
    } catch (error) {
      const resolvedError = toError(error);
      this.shutdown(resolvedError);
      throw resolvedError;
    }
  }

  private createWorkerSlot(): Promise<WorkerSlot> {
    const index = this.nextWorkerIndex++;
    const worker = this.dependencies.createWorker();
    this.workers.add(worker);
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      this.workers.delete(worker);
      retireWorker(worker);
    };
    try {
      const modelBytes = this.takeModelBytes();
      if (isPromiseLike(modelBytes)) {
        return modelBytes
          .then((loadedModelBytes) => {
            this.assertActive();
            return this.initializeWorker(worker, index, loadedModelBytes);
          })
          .catch((error) => {
            cleanup();
            throw error;
          });
      }
      this.assertActive();
      return this.initializeWorker(worker, index, modelBytes).catch((error) => {
        cleanup();
        throw error;
      });
    } catch (error) {
      cleanup();
      return Promise.reject(error);
    }
  }

  private initializeWorker(
    worker: Worker,
    index: number,
    modelBytes?: ArrayBuffer,
  ): Promise<WorkerSlot> {
    return new Promise<WorkerSlot>((resolve, reject) => {
      let settled = false;
      const timeoutID = setTimeout(() => {
        fail(new Error(`Layout worker ${index + 1} initialization timed out`));
      }, INITIALIZATION_TIMEOUT_MS);

      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutID);
        this.initializationRejectors.delete(cancelInitialization);
        reject(toError(error));
      };
      const cancelInitialization = (error: Error) => fail(error);
      this.initializationRejectors.add(cancelInitialization);

      worker.onerror = (event) => fail(event.error ?? event.message);
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const response = event.data;
        if (response.type === "ERROR") {
          fail(
            response.error ??
              response.message ??
              "Worker initialization failed",
          );
          return;
        }
        if (response.type !== "READY") return;

        if (settled) return;
        settled = true;
        clearTimeout(timeoutID);
        this.initializationRejectors.delete(cancelInitialization);
        const slot: WorkerSlot = { busy: false, index, worker };
        worker.onerror = (error) => this.handleWorkerFailure(slot, error);
        worker.onmessage = (message) =>
          this.handleWorkerMessage(
            slot,
            message as MessageEvent<WorkerResponse>,
          );
        const diagnostics = response.diagnostics;
        this.dependencies.log?.(
          `Layout worker ${index + 1} ready with ${diagnostics?.configuredInferenceThreads ?? response.inferenceThreads ?? "unknown"} configured inference threads`,
          diagnostics,
        );
        if (diagnostics) this.emitDiagnostics(diagnostics);
        resolve(slot);
      };

      const initializationMessage = {
        expectedModelHash: this.dependencies.expectedModelHash,
        expectedModelSize: this.dependencies.expectedModelSize,
        modelBytes,
        modelURL: this.dependencies.modelURL,
        modelName: this.dependencies.modelName,
        quantized: this.dependencies.quantized,
        resourceBaseURL: this.dependencies.resourceBaseURL,
        type: "INIT",
        wasmURL: this.dependencies.wasmURL,
      };
      try {
        if (modelBytes) worker.postMessage(initializationMessage, [modelBytes]);
        else worker.postMessage(initializationMessage);
      } catch (error) {
        fail(error);
      }
    });
  }

  private takeModelBytes(): ArrayBuffer | Promise<ArrayBuffer> | undefined {
    if (this.initialModelBytes) {
      const bytes = this.initialModelBytes;
      this.initialModelBytes = undefined;
      return bytes;
    }
    return this.dependencies.loadModelBytes?.();
  }

  private dispatchQueuedTasks(): void {
    for (const slot of this.slots) {
      if (slot.busy) continue;
      const task = this.queue.shift();
      if (!task) return;

      slot.busy = true;
      task.queueMs = Math.max(0, Date.now() - task.queuedAt);
      const timeoutID = setTimeout(() => {
        this.shutdown(
          new Error(`Page ${task.pageIndex + 1} layout detection timed out`),
        );
      }, this.dependencies.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS);
      this.activeTasks.set(task.taskID, { slot, task, timeoutID });
      try {
        slot.worker.postMessage(
          {
            imageData: task.imageData,
            pageIndex: task.pageIndex,
            queueMs: task.queueMs,
            taskID: task.taskID,
            type: "DETECT",
          },
          [task.imageData],
        );
      } catch (error) {
        this.shutdown(toError(error));
      }
    }
  }

  private handleWorkerMessage(
    slot: WorkerSlot,
    event: MessageEvent<WorkerResponse>,
  ): void {
    const response = event.data;
    if (response.type === "READY") return;
    if (response.taskID === undefined) {
      this.dependencies.log?.(
        "Ignored worker response without taskID",
        response,
      );
      return;
    }

    if (response.type === "ERROR") {
      this.emitTiming(response.taskID, response.timings);
      this.finishTask(
        response.taskID,
        new Error(
          response.error ?? response.message ?? "Layout detection failed",
        ),
      );
      return;
    }

    if (response.type === "RESULT") {
      const timings = this.emitTiming(response.taskID, response.timings);
      this.finishTask(
        response.taskID,
        undefined,
        response.results ?? [],
        timings,
      );
      return;
    }

    slot.busy = false;
    this.dispatchQueuedTasks();
  }

  private handleWorkerFailure(slot: WorkerSlot, error: ErrorEvent): void {
    this.dependencies.log?.("Layout worker failed", slot);
    this.shutdown(toError(error.error ?? error.message));
  }

  private finishTask(
    taskID: number,
    error?: Error,
    results: LayoutElement[] = [],
    timings?: LayoutDetectionTimings,
  ): void {
    const task = this.activeTasks.get(taskID);
    if (!task) return;

    clearTimeout(task.timeoutID);
    this.activeTasks.delete(taskID);
    task.slot.busy = false;
    this.settleTask(task.task, error, results, timings);
    this.dispatchQueuedTasks();
  }

  private cancelTask(task: DetectionTask): void {
    if (task.settled) return;
    const queueIndex = this.queue.indexOf(task);
    if (queueIndex >= 0) {
      this.queue.splice(queueIndex, 1);
      this.settleTask(task, new OperationCancelledError());
      this.dispatchQueuedTasks();
      return;
    }

    const activeTask = this.activeTasks.get(task.taskID);
    if (!activeTask) {
      this.settleTask(task, new OperationCancelledError());
      return;
    }

    clearTimeout(activeTask.timeoutID);
    this.activeTasks.delete(task.taskID);
    this.settleTask(task, new OperationCancelledError());
    this.replaceWorker(activeTask.slot);
  }

  private settleTask(
    task: DetectionTask,
    error?: Error,
    results: LayoutElement[] = [],
    timings?: LayoutDetectionTimings,
  ): void {
    if (task.settled) return;
    task.settled = true;
    if (task.abort) task.signal?.removeEventListener("abort", task.abort);
    if (error) task.reject(error);
    else {
      task.resolve({
        elements: results,
        timings: timings ?? createTimings(task.queueMs),
      });
    }
  }

  private replaceWorker(slot: WorkerSlot): void {
    const slotIndex = this.slots.indexOf(slot);
    if (slotIndex >= 0) this.slots.splice(slotIndex, 1);
    this.workers.delete(slot.worker);
    retireWorker(slot.worker);
    if (this.disposed) return;

    void this.createWorkerSlot().then(
      (replacement) => {
        if (this.disposed) {
          this.workers.delete(replacement.worker);
          retireWorker(replacement.worker);
          return;
        }
        this.slots.push(replacement);
        this.dispatchQueuedTasks();
      },
      (error) => {
        if (!this.disposed) this.shutdown(toError(error));
      },
    );
  }

  private emitDiagnostics(diagnostics: LayoutWorkerDiagnostics): void {
    try {
      this.dependencies.onDiagnostics?.(diagnostics);
    } catch (error) {
      this.dependencies.log?.(
        "Layout worker diagnostics callback failed",
        error,
      );
    }
  }

  private emitTiming(
    taskID: number,
    timings?: Partial<LayoutDetectionTimings>,
  ): LayoutDetectionTimings | undefined {
    const activeTask = this.activeTasks.get(taskID)?.task;
    if (!activeTask) return undefined;
    const normalized = createTimings(activeTask.queueMs, timings);
    try {
      this.dependencies.onTiming?.({
        ...normalized,
        pageIndex: activeTask.pageIndex,
        taskID,
      });
    } catch (error) {
      this.dependencies.log?.("Layout worker timing callback failed", error);
    }
    return normalized;
  }

  private assertActive(): void {
    if (this.disposed) {
      throw this.disposedError ?? new Error("Layout worker pool was disposed");
    }
  }

  private shutdown(error: Error): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disposedError = error;
    for (const task of this.queue.splice(0)) this.settleTask(task, error);
    for (const task of this.activeTasks.values()) {
      clearTimeout(task.timeoutID);
      this.settleTask(task.task, error);
    }
    this.activeTasks.clear();
    for (const reject of this.initializationRejectors) reject(error);
    this.initializationRejectors.clear();
    for (const worker of this.workers) retireWorker(worker);
    this.workers.clear();
    this.slots.length = 0;
    this.initialModelBytes = undefined;
  }
}

function createTimings(
  queueMs = 0,
  timings: Partial<LayoutDetectionTimings> = {},
): LayoutDetectionTimings {
  return {
    decodeMs: normalizeDuration(timings.decodeMs),
    inferenceMs: normalizeDuration(timings.inferenceMs),
    postprocessMs: normalizeDuration(timings.postprocessMs),
    preprocessMs: normalizeDuration(timings.preprocessMs),
    queueMs: normalizeDuration(timings.queueMs, queueMs),
    totalMs: normalizeDuration(timings.totalMs),
  };
}

function normalizeDuration(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function isPromiseLike<Value>(
  value: Value | Promise<Value> | undefined,
): value is Promise<Value> {
  return typeof (value as Promise<Value> | undefined)?.then === "function";
}

function retireWorker(worker: Worker): void {
  worker.onerror = null;
  worker.onmessage = null;
  worker.terminate();
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function waitForPromise<Value>(
  promise: Promise<Value>,
  signal?: AbortSignal,
): Promise<Value> {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise<Value>((resolve, reject) => {
    const abort = () => {
      cleanup();
      reject(new OperationCancelledError());
    };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}
