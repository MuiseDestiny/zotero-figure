import * as assert from "node:assert/strict";
import test from "node:test";
import { monitorImageLoad } from "../src/features/reader/imageLoadMonitor";

test("keeps an image load active until asynchronous decoding finishes", async () => {
  const decoded = createDeferred<void>();
  const image = new FakeImage(() => decoded.promise);
  const monitor = monitorImageLoad(image as unknown as HTMLImageElement);
  let outcome: string | undefined;
  void monitor.promise.then((value) => {
    outcome = value;
  });

  image.dispatchEvent(new Event("load"));
  await flushMicrotasks();
  assert.equal(outcome, undefined);

  decoded.resolve();
  assert.equal(await monitor.promise, "loaded");
  assert.equal(image.decodeCalls, 1);
});

test("reports image failures and lets a remount cancel active decoding", async () => {
  const failedImage = new FakeImage(async () => {});
  const failed = monitorImageLoad(failedImage as unknown as HTMLImageElement);
  failedImage.dispatchEvent(new Event("error"));
  assert.equal(await failed.promise, "failed");

  const decoded = createDeferred<void>();
  const cancelledImage = new FakeImage(() => decoded.promise);
  const cancelled = monitorImageLoad(
    cancelledImage as unknown as HTMLImageElement,
  );
  cancelledImage.dispatchEvent(new Event("load"));
  cancelled.cancel();
  assert.equal(await cancelled.promise, "cancelled");
  decoded.resolve();
  await flushMicrotasks();
});

class FakeImage extends EventTarget {
  public decodeCalls = 0;

  constructor(private readonly decodeImage: () => Promise<void>) {
    super();
  }

  public decode(): Promise<void> {
    this.decodeCalls++;
    return this.decodeImage();
  }
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve(value?: T): void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return {
    promise,
    resolve: (value) => resolve(value as T),
  };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
