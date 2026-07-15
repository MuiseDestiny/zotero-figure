import * as assert from "node:assert/strict";
import test from "node:test";
import {
  LayoutWorkerPool,
  type LayoutWorkerDiagnostics,
  type LayoutWorkerTiming,
} from "../src/services/layout/workerPool";
import { OperationCancelledError } from "../src/utils/cancellation";

class FakeWorker {
  public messages: Array<Record<string, unknown>> = [];
  public onerror: ((event: ErrorEvent) => unknown) | null = null;
  public onmessage: ((event: MessageEvent) => unknown) | null = null;
  public terminated = false;
  public transferLists: Array<readonly Transferable[] | undefined> = [];

  public constructor(
    private readonly readyResponse: Record<string, unknown> = {},
  ) {}

  public postMessage(
    message: Record<string, unknown>,
    transfer?: readonly Transferable[],
  ): void {
    this.messages.push(message);
    this.transferLists.push(transfer);
    if (message.type === "INIT") {
      queueMicrotask(() =>
        this.respond({ ...this.readyResponse, type: "READY" }),
      );
    }
  }

  public respond(data: Record<string, unknown>): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  public terminate(): void {
    this.terminated = true;
  }
}

test("runs at most one detection at a time on each worker", async () => {
  const worker = new FakeWorker();
  const pool = createPool([worker]);
  const first = pool.detect(new ArrayBuffer(1), 0);
  const second = pool.detect(new ArrayBuffer(1), 1);
  await flushTasks();

  assert.deepEqual(
    worker.messages.map(({ type }) => type),
    ["INIT", "DETECT"],
  );
  assert.deepEqual(worker.transferLists[1], [
    worker.messages[1].imageData as ArrayBuffer,
  ]);
  const firstTaskID = worker.messages[1].taskID as number;
  worker.respond({ results: [], taskID: firstTaskID, type: "RESULT" });
  await first;
  await flushTasks();

  assert.deepEqual(
    worker.messages.map(({ type }) => type),
    ["INIT", "DETECT", "DETECT"],
  );
  const secondTaskID = worker.messages[2].taskID as number;
  worker.respond({ results: [], taskID: secondTaskID, type: "RESULT" });
  await second;
  pool.dispose();
  assert.equal(worker.terminated, true);
});

test("runs two detections concurrently across two single-task workers", async () => {
  const firstWorker = new FakeWorker();
  const secondWorker = new FakeWorker();
  const pool = createPool([firstWorker, secondWorker], { workerCount: 2 });
  const first = pool.detect(new ArrayBuffer(1), 0);
  const second = pool.detect(new ArrayBuffer(1), 1);
  await flushTasks();

  assert.equal(firstWorker.messages[1].type, "DETECT");
  assert.equal(secondWorker.messages[1].type, "DETECT");
  firstWorker.respond({
    results: [],
    taskID: firstWorker.messages[1].taskID,
    type: "RESULT",
  });
  secondWorker.respond({
    results: [],
    taskID: secondWorker.messages[1].taskID,
    type: "RESULT",
  });
  await Promise.all([first, second]);
  pool.dispose();
});

test("rejects active and queued tasks when disposed", async () => {
  const worker = new FakeWorker();
  const pool = createPool([worker]);
  const active = pool.detect(new ArrayBuffer(1), 0);
  const queued = pool.detect(new ArrayBuffer(1), 1);
  await flushTasks();
  pool.dispose();

  await assert.rejects(active, /disposed/);
  await assert.rejects(queued, /disposed/);
  assert.equal(worker.terminated, true);
});

test("cancels immediately while workers are still initializing", async () => {
  const worker = new FakeWorker();
  worker.postMessage = function (message): void {
    this.messages.push(message);
  };
  const pool = createPool([worker]);
  const detection = pool.detect(new ArrayBuffer(1), 0);
  await flushTasks();

  const cancellation = new OperationCancelledError();
  pool.dispose(cancellation);

  await assert.rejects(detection, OperationCancelledError);
  assert.equal(worker.terminated, true);
});

test("preserves the cancellation reason after disposal", async () => {
  const pool = createPool([new FakeWorker()]);
  pool.dispose(new OperationCancelledError());

  await assert.rejects(
    pool.detect(new ArrayBuffer(1), 0),
    OperationCancelledError,
  );
});

test("hard-cancels an active task and rebuilds its worker", async () => {
  const firstWorker = new FakeWorker();
  const replacementWorker = new FakeWorker();
  let modelLoads = 0;
  const pool = createPool([firstWorker, replacementWorker], {
    loadModelBytes: async () => {
      modelLoads++;
      return new ArrayBuffer(1);
    },
  });
  const controller = new AbortController();
  const cancelled = pool.detect(new ArrayBuffer(1), 0, controller.signal);
  await flushTasks();
  const cancelledTaskID = firstWorker.messages[1].taskID as number;

  controller.abort();
  await assert.rejects(cancelled, OperationCancelledError);
  await flushTasks();
  assert.equal(firstWorker.terminated, true);
  assert.equal(replacementWorker.terminated, false);
  assert.equal(modelLoads, 2);
  assert.equal(replacementWorker.messages[0].type, "INIT");

  const next = pool.detect(new ArrayBuffer(1), 1);
  await flushTasks();
  assert.deepEqual(
    replacementWorker.messages.map(({ type }) => type),
    ["INIT", "DETECT"],
  );

  firstWorker.respond({
    results: [{ score: 1, type: "table", xyxy: [0, 0, 1, 1] }],
    taskID: cancelledTaskID,
    type: "RESULT",
  });
  await flushTasks();
  const nextTaskID = replacementWorker.messages[1].taskID as number;
  replacementWorker.respond({
    results: [],
    taskID: nextTaskID,
    type: "RESULT",
  });
  assert.deepEqual(await next, []);

  pool.dispose();
  assert.equal(replacementWorker.terminated, true);
});

test("returns stage timings and worker diagnostics to the main thread", async () => {
  const diagnostics: LayoutWorkerDiagnostics = {
    configuredInferenceThreads: 2,
    crossOriginIsolated: true,
    modelSource: "bytes",
    requestedInferenceThreads: 2,
    selectiveOutputEnabled: true,
    sharedArrayBufferAvailable: true,
  };
  const worker = new FakeWorker({ diagnostics, inferenceThreads: 2 });
  const observedDiagnostics: LayoutWorkerDiagnostics[] = [];
  const observedTimings: LayoutWorkerTiming[] = [];
  const pool = createPool([worker], {
    onDiagnostics: (value) => observedDiagnostics.push(value),
    onTiming: (value) => observedTimings.push(value),
  });
  const detection = pool.detectWithTiming(new ArrayBuffer(1), 4);
  await flushTasks();
  const taskID = worker.messages[1].taskID as number;
  const timings = {
    decodeMs: 1,
    inferenceMs: 3,
    postprocessMs: 4,
    preprocessMs: 2,
    queueMs: 0.5,
    totalMs: 10,
  };
  worker.respond({ results: [], taskID, timings, type: "RESULT" });

  assert.deepEqual(await detection, { elements: [], timings });
  assert.deepEqual(observedDiagnostics, [diagnostics]);
  assert.deepEqual(observedTimings, [{ ...timings, pageIndex: 4, taskID }]);
  pool.dispose();
});

test("transfers provided model bytes during worker initialization", async () => {
  const worker = new FakeWorker();
  const modelBytes = new ArrayBuffer(8);
  const pool = createPool([worker], { modelBytes });

  await pool.prepare();

  assert.equal(worker.messages[0].modelBytes, modelBytes);
  assert.deepEqual(worker.transferLists[0], [modelBytes]);
  pool.dispose();
});

interface PoolOptions {
  loadModelBytes?: () => Promise<ArrayBuffer>;
  modelBytes?: ArrayBuffer;
  onDiagnostics?: (diagnostics: LayoutWorkerDiagnostics) => void;
  onTiming?: (timing: LayoutWorkerTiming) => void;
  workerCount?: number;
}

function createPool(
  workers: FakeWorker[],
  options: PoolOptions = {},
): LayoutWorkerPool {
  let index = 0;
  return new LayoutWorkerPool({
    createWorker: () => {
      const worker = workers[index++];
      if (!worker) throw new Error("Test did not provide a replacement worker");
      return worker as unknown as Worker;
    },
    expectedModelHash: "0".repeat(64),
    expectedModelSize: 1,
    loadModelBytes: options.loadModelBytes,
    modelBytes: options.modelBytes,
    modelURL: "chrome://test/content/model.onnx",
    modelName: "test-model",
    onDiagnostics: options.onDiagnostics,
    onTiming: options.onTiming,
    quantized: false,
    resourceBaseURL: "chrome://test/content/",
    wasmURL: "chrome://test/content/model.wasm",
    workerCount: options.workerCount ?? 1,
  });
}

async function flushTasks(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}
