import * as assert from "node:assert/strict";
import test from "node:test";
import type { ImageLoadMonitor } from "../src/features/reader/imageLoadMonitor";
import {
  SidebarImageLoadCoordinator,
  type SidebarImageSource,
} from "../src/features/reader/sidebarImageLoadCoordinator";

test("loads only previews inside the configured viewport margin", async () => {
  const harness = createHarness();
  const visible = harness.createContainer({ bottom: 200, top: 150 });
  const outside = harness.createContainer({ bottom: 1_000, top: 950 });
  harness.coordinator.register(visible.element, createSource("visible"), "A");
  harness.coordinator.register(outside.element, createSource("outside"), "B");

  harness.activate({ bottom: 500, top: 100 });
  await waitFor(
    () => harness.reads.length === 1 && visible.childState === "image",
  );
  assert.deepEqual(harness.reads, ["/visible.png"]);
  assert.equal(visible.childState, "image");
  assert.equal(visible.element.style.aspectRatio, "");
  assert.equal(visible.element.classList.contains("is-loaded"), true);
  assert.equal(outside.childState, "pending");
  harness.coordinator.updateResult(createSource("visible"), "updated alt");
  assert.equal(visible.imageAlt, "updated alt");

  outside.bounds = { bottom: 900, top: 850 };
  harness.coordinator.refresh();
  harness.timers.flush();
  await waitFor(() => harness.reads.length === 2);
  assert.deepEqual(harness.reads, ["/visible.png", "/outside.png"]);
  harness.coordinator.dispose();
});

test("keeps the placeholder visible until an image is ready", async () => {
  const outcome = createDeferred<"cancelled" | "failed" | "loaded">();
  let monitorCreated = false;
  const harness = createHarness({
    monitorImage: () => {
      monitorCreated = true;
      return {
        cancel: () => outcome.resolve("cancelled"),
        promise: outcome.promise,
      };
    },
  });
  const container = harness.createContainer({ bottom: 200, top: 150 });
  harness.coordinator.register(container.element, createSource("visible"), "A");

  harness.activate({ bottom: 500, top: 100 });
  await waitFor(() => monitorCreated);
  assert.equal(container.childState, "pending");

  outcome.resolve("loaded");
  await waitFor(() => container.childState === "image");
  harness.coordinator.dispose();
});

test("retries the initial scan until the sidebar cards are mounted", async () => {
  const harness = createHarness();
  const container = harness.createContainer({ bottom: 200, top: 150 });
  container.isConnected = false;
  harness.coordinator.register(container.element, createSource("delayed"), "A");

  const viewport = harness.activate({ bottom: 500, top: 100 });
  viewport.isConnected = false;
  harness.timers.flush();
  assert.deepEqual(harness.reads, []);
  assert.equal(harness.timers.pendingCount, 1);

  viewport.isConnected = true;
  harness.timers.flush();
  assert.deepEqual(harness.reads, []);
  assert.equal(harness.timers.pendingCount, 1);

  container.isConnected = true;
  harness.timers.flush();
  await waitFor(() => container.childState === "image");
  harness.timers.flush();
  assert.deepEqual(harness.reads, ["/delayed.png"]);
  assert.equal(harness.timers.pendingCount, 0);
  harness.coordinator.dispose();
});

test("stops mount retries while inactive and resumes when shown", async () => {
  const harness = createHarness();
  const container = harness.createContainer({ bottom: 200, top: 150 });
  container.isConnected = false;
  harness.coordinator.register(container.element, createSource("delayed"), "A");

  harness.activate({ bottom: 500, top: 100 });
  assert.equal(harness.timers.pendingCount, 1);
  harness.coordinator.setActive(false);
  assert.equal(harness.timers.pendingCount, 0);

  container.isConnected = true;
  harness.coordinator.setActive(true);
  harness.timers.flush();
  await waitFor(() => container.childState === "image");
  assert.deepEqual(harness.reads, ["/delayed.png"]);
  harness.coordinator.dispose();
});

test("cancels queued work while hidden and queues it again when shown", async () => {
  const reads = new Map<string, Deferred<Uint8Array>>();
  const harness = createHarness({
    concurrency: 1,
    readBytes: (path) => {
      const read = createDeferred<Uint8Array>();
      reads.set(path, read);
      return read.promise;
    },
  });
  for (let index = 0; index < 3; index++) {
    const container = harness.createContainer({ bottom: 200, top: 150 });
    harness.coordinator.register(
      container.element,
      createSource(String(index)),
      String(index),
    );
  }

  harness.activate({ bottom: 500, top: 100 });
  await waitFor(() => reads.size === 1);
  harness.coordinator.setActive(false);
  reads.get("/0.png")?.resolve(Uint8Array.of(0));
  await flushMicrotasks();
  assert.equal(reads.size, 1);

  harness.coordinator.setActive(true);
  harness.timers.flush();
  await waitFor(() => reads.size === 2);
  reads.get("/1.png")?.resolve(Uint8Array.of(1));
  await waitFor(() => reads.size === 3);
  reads.get("/2.png")?.resolve(Uint8Array.of(2));
  await flushMicrotasks();
  harness.coordinator.dispose();
});

test("bounds active reads and keeps zero-height fallback batches bounded", async () => {
  const reads = new Map<string, Deferred<Uint8Array>>();
  let activeReads = 0;
  let peakReads = 0;
  const harness = createHarness({
    concurrency: 2,
    readBytes: (path) => {
      activeReads++;
      peakReads = Math.max(peakReads, activeReads);
      const read = createDeferred<Uint8Array>();
      reads.set(path, read);
      return read.promise.finally(() => activeReads--);
    },
  });
  for (let index = 0; index < 5; index++) {
    const container = harness.createContainer({ bottom: 0, top: 0 });
    harness.coordinator.register(
      container.element,
      createSource(String(index)),
      String(index),
    );
  }

  harness.activate({ bottom: 0, top: 0 });
  await waitFor(() => reads.size === 2);
  assert.equal(peakReads, 2);

  for (let offset = 0; offset < 5; offset += 2) {
    for (const [path, read] of [...reads]) {
      if (read.settled) continue;
      read.resolve(Uint8Array.of(Number(path.match(/\d+/)?.[0] ?? 0)));
    }
    const expected = Math.min(5, offset + 4);
    await waitFor(() => {
      harness.timers.flush();
      return reads.size >= expected;
    });
  }
  await waitFor(() => activeReads === 0);
  assert.equal(peakReads, 2);
  harness.coordinator.dispose();
});

test("keeps failure UI and releases a Blob URL after image failure", async () => {
  const logs: Error[] = [];
  let releases = 0;
  const harness = createHarness({
    logError: (error) => logs.push(error),
    monitorImage: () => ({
      cancel: () => {},
      promise: Promise.resolve("failed"),
    }),
    onReleaseBlob: () => releases++,
  });
  const container = harness.createContainer({ bottom: 200, top: 150 });
  harness.coordinator.register(container.element, createSource("failed"), "X");
  assert.equal(container.childState, "pending");

  harness.activate({ bottom: 500, top: 100 });
  await waitFor(() => container.childState === "failed");

  assert.equal(releases, 1);
  assert.deepEqual(logs, []);
  assert.equal(container.element.style.aspectRatio, "1 / 1");
  assert.equal(container.element.classList.contains("is-loaded"), false);
  harness.coordinator.dispose();
});

test("releases the current Blob URL when monitor setup throws", async () => {
  const logs: Error[] = [];
  let releases = 0;
  const harness = createHarness({
    logError: (error) => logs.push(error),
    monitorImage: () => {
      throw new Error("monitor setup failed");
    },
    onReleaseBlob: () => releases++,
  });
  const container = harness.createContainer({ bottom: 200, top: 150 });
  harness.coordinator.register(container.element, createSource("throw"), "X");

  harness.activate({ bottom: 500, top: 100 });
  await waitFor(() => container.childState === "failed");

  assert.equal(releases, 1);
  assert.equal(logs.length, 1);
  assert.match(logs[0]?.message ?? "", /monitor setup failed/);
  harness.coordinator.dispose();
  assert.equal(releases, 1);
});

test("invalidates stale reads while allowing the next generation to load", async () => {
  const reads = new Map<string, Deferred<Uint8Array>>();
  const createdBlobs: number[] = [];
  const harness = createHarness({
    concurrency: 2,
    onCreateBlob: (bytes) => createdBlobs.push(bytes[0] ?? -1),
    readBytes: (path) => {
      const read = createDeferred<Uint8Array>();
      reads.set(path, read);
      return read.promise;
    },
  });
  const oldContainer = harness.createContainer({ bottom: 200, top: 150 });
  harness.coordinator.register(
    oldContainer.element,
    { id: "same", imagePath: "/old.png" },
    "old",
  );
  harness.activate({ bottom: 500, top: 100 });
  await waitFor(() => reads.has("/old.png"));

  harness.coordinator.reset();
  const currentContainer = harness.createContainer({ bottom: 200, top: 150 });
  harness.coordinator.register(
    currentContainer.element,
    { id: "same", imagePath: "/current.png" },
    "current",
  );
  harness.coordinator.refresh();
  harness.timers.flush();
  await waitFor(() => reads.has("/current.png"));

  reads.get("/current.png")?.resolve(Uint8Array.of(2));
  await waitFor(() => currentContainer.childState === "image");
  reads.get("/old.png")?.resolve(Uint8Array.of(1));
  await flushMicrotasks();

  assert.deepEqual(createdBlobs, [2]);
  assert.equal(oldContainer.childState, "pending");
  assert.equal(currentContainer.imageAlt, "current");
  harness.coordinator.dispose();
});

test("cancels active monitoring and releases URLs during reset and dispose", async () => {
  const monitors: Array<{
    deferred: Deferred<"cancelled" | "failed" | "loaded">;
    cancellations: number;
  }> = [];
  let releases = 0;
  const harness = createHarness({
    monitorImage: () => {
      const state = {
        cancellations: 0,
        deferred: createDeferred<"cancelled" | "failed" | "loaded">(),
      };
      monitors.push(state);
      return {
        cancel: () => {
          state.cancellations++;
          state.deferred.resolve("cancelled");
        },
        promise: state.deferred.promise,
      };
    },
    onReleaseBlob: () => releases++,
  });
  const first = harness.createContainer({ bottom: 200, top: 150 });
  harness.coordinator.register(first.element, createSource("first"), "first");
  harness.activate({ bottom: 500, top: 100 });
  await waitFor(() => monitors.length === 1);

  harness.coordinator.reset();
  assert.equal(monitors[0]?.cancellations, 1);
  assert.equal(releases, 1);

  const second = harness.createContainer({ bottom: 200, top: 150 });
  harness.coordinator.register(
    second.element,
    createSource("second"),
    "second",
  );
  harness.coordinator.refresh();
  harness.timers.flush();
  await waitFor(() => monitors.length === 2);
  harness.coordinator.dispose();

  assert.equal(monitors[1]?.cancellations, 1);
  assert.equal(releases, 2);
  harness.coordinator.dispose();
  assert.equal(releases, 2);
});

interface HarnessOptions {
  concurrency?: number;
  logError?(error: Error): void;
  monitorImage?(image: HTMLImageElement): ImageLoadMonitor;
  onCreateBlob?(bytes: Uint8Array): void;
  onReleaseBlob?(): void;
  readBytes?(path: string): Promise<Uint8Array>;
}

function createHarness(options: HarnessOptions = {}): {
  activate(bounds: Bounds): FakeViewport;
  coordinator: SidebarImageLoadCoordinator;
  createContainer(bounds: Bounds): FakeContainer;
  reads: string[];
  timers: FakeTimers;
} {
  const document = new FakeDocument();
  const timers = new FakeTimers();
  const reads: string[] = [];
  let nextBlobID = 0;
  const coordinator = new SidebarImageLoadCoordinator({
    concurrency: options.concurrency,
    createBlobURL: (_document, bytes) => {
      options.onCreateBlob?.(bytes);
      const url = `blob:test-${++nextBlobID}`;
      let released = false;
      return {
        url,
        release: () => {
          if (released) return;
          released = true;
          options.onReleaseBlob?.();
        },
      };
    },
    createPlaceholder: (_document, state) => ({ state }) as unknown as Node,
    logError: options.logError ?? (() => {}),
    monitorImage:
      options.monitorImage ??
      (() => ({ cancel: () => {}, promise: Promise.resolve("loaded") })),
    ownerWindow: timers as unknown as Pick<
      Window,
      "clearTimeout" | "setTimeout"
    >,
    readBytes:
      options.readBytes ??
      (async (path) => {
        reads.push(path);
        return Uint8Array.of(reads.length);
      }),
  });
  return {
    activate: (bounds) => {
      const viewport = new FakeViewport(bounds);
      coordinator.setViewport(viewport as unknown as HTMLElement);
      coordinator.setActive(true);
      timers.flush();
      return viewport;
    },
    coordinator,
    createContainer: (bounds) => new FakeContainer(document, bounds),
    reads,
    timers,
  };
}

interface Bounds {
  bottom: number;
  top: number;
}

class FakeContainer {
  public bounds: Bounds;
  public readonly classList = new FakeClassList();
  public readonly element: HTMLDivElement;
  public isConnected = true;
  public readonly style = { aspectRatio: "1 / 1" };
  private children: unknown[] = [];

  constructor(
    public readonly ownerDocument: FakeDocument,
    bounds: Bounds,
  ) {
    this.bounds = bounds;
    this.element = this as unknown as HTMLDivElement;
  }

  public get childState(): string | undefined {
    const child = this.children[0] as
      | FakeImage
      | { state?: string }
      | undefined;
    return child instanceof FakeImage ? "image" : child?.state;
  }

  public get imageAlt(): string | undefined {
    const child = this.children[0];
    return child instanceof FakeImage ? child.alt : undefined;
  }

  public getBoundingClientRect(): DOMRect {
    return this.bounds as DOMRect;
  }

  public replaceChildren(...children: unknown[]): void {
    this.children = children;
  }
}

class FakeViewport {
  public isConnected = true;

  constructor(private readonly bounds: Bounds) {}

  public getBoundingClientRect(): DOMRect {
    return this.bounds as DOMRect;
  }
}

class FakeDocument {
  public createElement(tag: string): HTMLElement {
    if (tag === "img") return new FakeImage() as unknown as HTMLElement;
    throw new Error(`Unexpected element: ${tag}`);
  }
}

class FakeImage {
  public alt = "";
  public decoding = "auto";
  public src = "";
}

class FakeClassList {
  private readonly values = new Set<string>();

  public add(value: string): void {
    this.values.add(value);
  }

  public contains(value: string): boolean {
    return this.values.has(value);
  }
}

class FakeTimers {
  private callbacks = new Map<number, () => void>();
  private nextID = 1;

  public get pendingCount(): number {
    return this.callbacks.size;
  }

  public clearTimeout(id: number): void {
    this.callbacks.delete(id);
  }

  public setTimeout(callback: TimerHandler): number {
    if (typeof callback !== "function") {
      throw new Error("String timers are unsupported in tests");
    }
    const id = this.nextID++;
    this.callbacks.set(id, callback as () => void);
    return id;
  }

  public flush(): void {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const callback of callbacks) callback();
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  readonly settled: boolean;
  resolve(value: T): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise!: (value: T) => void;
  let settled = false;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    get settled() {
      return settled;
    },
    resolve: (value) => {
      if (settled) return;
      settled = true;
      resolvePromise(value);
    },
  };
}

function createSource(id: string): SidebarImageSource {
  return { id, imagePath: `/${id}.png` };
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("Timed out waiting for sidebar image loading");
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
