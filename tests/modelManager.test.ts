import * as assert from "node:assert/strict";
import test from "node:test";
import {
  MODEL_VARIANTS,
  RECOMMENDED_MODEL,
} from "../src/services/model/modelCatalog";
import { ModelManager } from "../src/services/model/modelManager";
import { OperationCancelledError } from "../src/utils/cancellation";

test("validates models by exact size and SHA-256 and caches unchanged files", async () => {
  const previousIOUtils = globalThis.IOUtils;
  const variant = MODEL_VARIANTS[0];
  let digestCalls = 0;
  const files = new Map<
    string,
    { hash: string; lastModified: number; size: number }
  >([
    [
      "/valid.onnx",
      { hash: variant.sha256, lastModified: 1, size: variant.size },
    ],
    [
      "/wrong-size.onnx",
      { hash: variant.sha256, lastModified: 1, size: variant.size + 1 },
    ],
    [
      "/wrong-hash.onnx",
      { hash: "0".repeat(64), lastModified: 1, size: variant.size },
    ],
  ]);
  globalThis.IOUtils = {
    computeHexDigest: async (path: string) => {
      digestCalls++;
      return files.get(path)?.hash ?? "";
    },
    exists: async (path: string) => files.has(path),
    stat: async (path: string) => {
      const file = files.get(path);
      if (!file) throw new Error(`Missing test file: ${path}`);
      return {
        lastModified: file.lastModified,
        size: file.size,
      } as FileInfo;
    },
  } as unknown as typeof IOUtils;

  try {
    const manager = new ModelManager();
    const valid = await manager.validate("/valid.onnx");
    assert.equal(valid.state, "valid");
    if (valid.state === "valid") assert.equal(valid.variant.id, variant.id);
    assert.equal(digestCalls, 1);

    assert.equal((await manager.validate("/valid.onnx")).state, "valid");
    assert.equal(digestCalls, 1, "unchanged model should use validation cache");

    assert.equal((await manager.validate("/wrong-size.onnx")).state, "invalid");
    assert.equal(
      digestCalls,
      1,
      "wrong size should be rejected before hashing",
    );

    const wrongHash = await manager.validate("/wrong-hash.onnx");
    assert.equal(wrongHash.state, "invalid");
    if (wrongHash.state === "invalid") {
      assert.equal(wrongHash.actualHash, "0".repeat(64));
    }
    assert.equal(digestCalls, 2);

    await manager.validate("/valid.onnx", true);
    assert.equal(digestCalls, 3, "forced validation should recompute SHA-256");
  } finally {
    globalThis.IOUtils = previousIOUtils;
  }
});

test("installs the bundled Q8 model from the local chrome resource", async () => {
  const previousIOUtils = globalThis.IOUtils;
  const previousPathUtils = globalThis.PathUtils;
  const previousZotero = globalThis.Zotero;
  const files = new Map<string, Uint8Array>();
  const modelBytes = new Uint8Array(RECOMMENDED_MODEL.size);
  const progressValues: number[] = [];
  let requestCount = 0;
  let requestedURL = "";

  globalThis.PathUtils = {
    join: (...parts: string[]) => parts.join("/").replace(/\/+/g, "/"),
  } as unknown as typeof PathUtils;
  globalThis.IOUtils = {
    computeHexDigest: async (path: string) =>
      files.get(path)?.byteLength === RECOMMENDED_MODEL.size
        ? RECOMMENDED_MODEL.sha256
        : "0".repeat(64),
    exists: async (path: string) => files.has(path),
    makeDirectory: async () => undefined,
    move: async (source: string, destination: string) => {
      const bytes = files.get(source);
      if (!bytes) throw new Error(`Missing source: ${source}`);
      files.set(destination, bytes);
      files.delete(source);
    },
    remove: async (path: string) => {
      files.delete(path);
    },
    stat: async (path: string) =>
      ({
        lastModified: 1,
        size: files.get(path)?.byteLength,
      }) as FileInfo,
    write: async (path: string, bytes: Uint8Array) => {
      files.set(path, bytes);
      return bytes.byteLength;
    },
  } as unknown as typeof IOUtils;
  globalThis.Zotero = {
    DataDirectory: { dir: "/data" },
    HTTP: {
      request: async (
        _method: string,
        url: string,
        options: {
          requestObserver?: (request: XMLHttpRequest) => void;
        },
      ) => {
        requestCount++;
        requestedURL = url;
        options.requestObserver?.({
          addEventListener: (_type: string, listener: EventListener) => {
            listener({
              lengthComputable: true,
              loaded: modelBytes.byteLength,
              total: modelBytes.byteLength,
            } as ProgressEvent);
          },
        } as unknown as XMLHttpRequest);
        return { response: modelBytes.buffer };
      },
    },
    logError: () => undefined,
  } as unknown as typeof Zotero;

  try {
    const manager = new ModelManager();
    const validation = await manager.ensureRecommendedModel({
      onProgress: ({ loaded }) => progressValues.push(loaded),
    });

    assert.equal(validation.state, "valid");
    assert.equal(
      requestedURL,
      `chrome://zoterofigure/content/${RECOMMENDED_MODEL.embeddedPath}`,
    );
    assert.equal(requestCount, 1);
    assert.deepEqual(progressValues, [RECOMMENDED_MODEL.size]);
    assert.equal(files.has(manager.getRecommendedPath()), true);

    await manager.ensureRecommendedModel();
    assert.equal(requestCount, 1, "valid installed model should be reused");

    await manager.restoreRecommendedModel();
    assert.equal(requestCount, 2, "restore should reinstall from the XPI");
  } finally {
    globalThis.IOUtils = previousIOUtils;
    globalThis.PathUtils = previousPathUtils;
    globalThis.Zotero = previousZotero;
  }
});

test("caller cancellation preserves duplicate subscriptions to a shared model installation", async () => {
  const previousIOUtils = globalThis.IOUtils;
  const previousPathUtils = globalThis.PathUtils;
  const previousZotero = globalThis.Zotero;
  const files = new Map<string, Uint8Array>();
  const modelBytes = new Uint8Array(RECOMMENDED_MODEL.size);
  let progressListener: EventListener | undefined;
  let requestCount = 0;
  let resolveRequest!: (value: { response: ArrayBuffer }) => void;

  globalThis.PathUtils = {
    join: (...parts: string[]) => parts.join("/").replace(/\/+/g, "/"),
  } as unknown as typeof PathUtils;
  globalThis.IOUtils = {
    computeHexDigest: async (path: string) =>
      files.get(path)?.byteLength === RECOMMENDED_MODEL.size
        ? RECOMMENDED_MODEL.sha256
        : "0".repeat(64),
    exists: async (path: string) => files.has(path),
    makeDirectory: async () => undefined,
    move: async (source: string, destination: string) => {
      const bytes = files.get(source);
      if (!bytes) throw new Error(`Missing source: ${source}`);
      files.set(destination, bytes);
      files.delete(source);
    },
    remove: async (path: string) => {
      files.delete(path);
    },
    stat: async (path: string) =>
      ({
        lastModified: 1,
        size: files.get(path)?.byteLength,
      }) as FileInfo,
    write: async (path: string, bytes: Uint8Array) => {
      files.set(path, bytes);
      return bytes.byteLength;
    },
  } as unknown as typeof IOUtils;
  globalThis.Zotero = {
    DataDirectory: { dir: "/data" },
    HTTP: {
      request: async (
        _method: string,
        _url: string,
        options: {
          requestObserver?: (request: XMLHttpRequest) => void;
        },
      ) => {
        requestCount++;
        options.requestObserver?.({
          addEventListener: (_type: string, listener: EventListener) => {
            progressListener = listener;
          },
        } as unknown as XMLHttpRequest);
        return new Promise<{ response: ArrayBuffer }>((resolve) => {
          resolveRequest = resolve;
        });
      },
    },
    logError: () => undefined,
  } as unknown as typeof Zotero;

  try {
    const manager = new ModelManager();
    const controller = new AbortController();
    const progressValues: number[] = [];
    const progressReceivers: unknown[] = [];
    const onProgress = function (
      this: unknown,
      { loaded }: { loaded: number },
    ) {
      progressReceivers.push(this);
      progressValues.push(loaded);
    };
    const first = manager.ensureRecommendedModel({
      onProgress,
      signal: controller.signal,
    });
    const second = manager.ensureRecommendedModel({
      onProgress,
    });
    await waitFor(() => requestCount === 1 && progressListener !== undefined);
    progressListener?.({
      lengthComputable: true,
      loaded: 1,
      total: RECOMMENDED_MODEL.size,
    } as ProgressEvent);
    assert.deepEqual(progressValues, [1, 1]);
    assert.deepEqual(progressReceivers, [undefined, undefined]);

    controller.abort();
    await assert.rejects(first, OperationCancelledError);
    progressListener?.({
      lengthComputable: true,
      loaded: 2,
      total: RECOMMENDED_MODEL.size,
    } as ProgressEvent);
    assert.deepEqual(progressValues, [1, 1, 2]);
    assert.deepEqual(progressReceivers, [undefined, undefined, undefined]);

    resolveRequest({ response: modelBytes.buffer });
    assert.equal((await second).state, "valid");
    assert.equal(requestCount, 1);
  } finally {
    globalThis.IOUtils = previousIOUtils;
    globalThis.PathUtils = previousPathUtils;
    globalThis.Zotero = previousZotero;
  }
});

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("Timed out waiting for model installation");
}
