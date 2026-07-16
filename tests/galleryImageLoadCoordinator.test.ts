import * as assert from "node:assert/strict";
import test from "node:test";
import type { FigureGalleryImage } from "../src/domain/figureGallery";
import {
  GalleryImageLoadCoordinator,
  type GalleryImageLoadRuntime,
} from "../src/features/gallery/galleryImageLoadCoordinator";
import type {
  ImageLoadMonitor,
  ImageLoadOutcome,
} from "../src/features/reader/imageLoadMonitor";

const payload: FigureGalleryImage = {
  base64: "AQID",
  mimeType: "image/png",
};

test("bounds gallery image work and retains URLs until the next generation", async () => {
  const runtime = new FakeImageRuntime();
  const readIDs: string[] = [];
  const loaded: string[] = [];
  const coordinator = new GalleryImageLoadCoordinator(
    async (entryID) => {
      readIDs.push(entryID);
      return payload;
    },
    { runtime },
  );
  const generation = coordinator.beginGeneration();
  const images = Array.from({ length: 5 }, () => new FakeImage());
  for (const [index, image] of images.entries()) {
    coordinator.enqueue({
      entryID: `entry-${index}`,
      generation,
      image: image as unknown as HTMLImageElement,
      onFailed: () => assert.fail("a successful image was reported as failed"),
      onLoaded: () => loaded.push(`entry-${index}`),
    });
  }

  await waitFor(() => readIDs.length === 4 && runtime.createdURLs.length === 4);
  assert.deepEqual(readIDs, ["entry-0", "entry-1", "entry-2", "entry-3"]);

  runtime.complete(images[0], "loaded");
  await waitFor(() => readIDs.length === 5 && runtime.createdURLs.length === 5);
  for (const image of images.slice(1)) runtime.complete(image, "loaded");
  await waitFor(() => loaded.length === 5);

  assert.deepEqual(runtime.revokedURLs, []);
  assert.equal(coordinator.beginGeneration(), generation + 1);
  assert.deepEqual(runtime.revokedURLs.sort(), runtime.createdURLs.sort());
});

test("drops stale reads and cancels active decoding with its Blob URL", async () => {
  const runtime = new FakeImageRuntime();
  const staleRead = createDeferred<FigureGalleryImage>();
  const loaded: string[] = [];
  const failed: string[] = [];
  const coordinator = new GalleryImageLoadCoordinator(
    async (entryID) =>
      entryID === "stale" ? await staleRead.promise : payload,
    { concurrency: 1, runtime },
  );
  const staleGeneration = coordinator.beginGeneration();
  const staleImage = new FakeImage();
  coordinator.enqueue(
    request(staleImage, "stale", staleGeneration, loaded, failed),
  );
  await flushMicrotasks();

  const currentGeneration = coordinator.beginGeneration();
  staleRead.resolve(payload);
  await flushMicrotasks();
  assert.deepEqual(runtime.createdURLs, []);

  const failedImage = new FakeImage();
  coordinator.enqueue(
    request(failedImage, "failed", currentGeneration, loaded, failed),
  );
  await waitFor(() => runtime.hasMonitor(failedImage));
  runtime.complete(failedImage, "failed");
  await waitFor(() => failed.includes("failed"));
  assert.deepEqual(runtime.revokedURLs, ["blob:0"]);

  const cancelledImage = new FakeImage();
  coordinator.enqueue(
    request(cancelledImage, "cancelled", currentGeneration, loaded, failed),
  );
  await waitFor(() => runtime.hasMonitor(cancelledImage));
  coordinator.beginGeneration();
  await flushMicrotasks();

  assert.equal(runtime.cancelCalls, 1);
  assert.deepEqual(runtime.revokedURLs, ["blob:0", "blob:1"]);
  assert.deepEqual(loaded, []);
  assert.deepEqual(failed, ["failed"]);
});

test("cancels monitoring and releases the URL when assigning src fails", async () => {
  const runtime = new FakeImageRuntime();
  const failed: string[] = [];
  const coordinator = new GalleryImageLoadCoordinator(async () => payload, {
    runtime,
  });
  const generation = coordinator.beginGeneration();
  const image = new ThrowingImage();

  coordinator.enqueue(request(image, "broken", generation, [], failed));
  await waitFor(() => failed.length === 1);

  assert.equal(runtime.cancelCalls, 1);
  assert.deepEqual(runtime.revokedURLs, ["blob:0"]);
  assert.deepEqual(failed, ["broken"]);
});

function request(
  image: FakeImage,
  entryID: string,
  generation: number,
  loaded: string[],
  failed: string[],
) {
  return {
    entryID,
    generation,
    image: image as unknown as HTMLImageElement,
    onFailed: () => failed.push(entryID),
    onLoaded: () => loaded.push(entryID),
  };
}

class FakeImage {
  public isConnected = true;
  private source = "";

  public get src(): string {
    return this.source;
  }

  public set src(value: string) {
    this.source = value;
  }
}

class ThrowingImage extends FakeImage {
  public override get src(): string {
    return "";
  }

  public override set src(_value: string) {
    throw new Error("src assignment failed");
  }
}

class FakeImageRuntime implements GalleryImageLoadRuntime {
  public cancelCalls = 0;
  public readonly createdURLs: string[] = [];
  public readonly revokedURLs: string[] = [];
  private readonly monitors = new Map<FakeImage, Deferred<ImageLoadOutcome>>();

  public createObjectURL(received: FigureGalleryImage): string {
    assert.deepEqual(received, payload);
    const url = `blob:${this.createdURLs.length}`;
    this.createdURLs.push(url);
    return url;
  }

  public monitor(image: HTMLImageElement): ImageLoadMonitor {
    const target = image as unknown as FakeImage;
    const outcome = createDeferred<ImageLoadOutcome>();
    this.monitors.set(target, outcome);
    return {
      cancel: () => {
        this.cancelCalls++;
        outcome.resolve("cancelled");
      },
      promise: outcome.promise,
    };
  }

  public revokeObjectURL(url: string): void {
    this.revokedURLs.push(url);
  }

  public complete(image: FakeImage, outcome: ImageLoadOutcome): void {
    const monitor = this.monitors.get(image);
    assert.ok(monitor, "image monitor was not created");
    monitor.resolve(outcome);
  }

  public hasMonitor(image: FakeImage): boolean {
    return this.monitors.has(image);
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("Timed out waiting for gallery image state");
}
