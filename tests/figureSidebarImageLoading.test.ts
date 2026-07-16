import * as assert from "node:assert/strict";
import test from "node:test";
import { isNearVerticalViewport } from "../src/domain/figureSidebar";
import { BoundedAsyncTaskQueue } from "../src/services/concurrency/boundedAsyncTaskQueue";

test("bounds active sidebar image tasks", async () => {
  const queue = new BoundedAsyncTaskQueue(3);
  const releases: Array<() => void> = [];
  let active = 0;
  let peak = 0;
  const tasks = Array.from({ length: 9 }, () =>
    queue.enqueue(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active--;
    }),
  );

  await waitFor(() => releases.length === 3);
  assert.equal(queue.activeCount, 3);
  assert.equal(queue.pendingCount, 6);
  assert.equal(peak, 3);

  while (releases.length > 0) {
    const batch = releases.splice(0);
    for (const release of batch) release();
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  await Promise.all(tasks.map(({ promise }) => promise));

  assert.equal(queue.activeCount, 0);
  assert.equal(queue.pendingCount, 0);
  assert.equal(peak, 3);
});

test("cancels queued image tasks without interrupting active tasks", async () => {
  const queue = new BoundedAsyncTaskQueue(2);
  const activeReleases: Array<() => void> = [];
  const started: number[] = [];
  const tasks = Array.from({ length: 5 }, (_, index) =>
    queue.enqueue(async () => {
      started.push(index);
      await new Promise<void>((resolve) => activeReleases.push(resolve));
    }),
  );

  await waitFor(() => activeReleases.length === 2);
  assert.equal(queue.cancelPending(), 3);
  assert.equal(queue.activeCount, 2);
  assert.equal(queue.pendingCount, 0);
  for (const release of activeReleases.splice(0)) release();
  await Promise.all(tasks.map(({ promise }) => promise));

  assert.deepEqual(started, [0, 1]);
  assert.equal(tasks[0].started, true);
  assert.equal(tasks[2].started, false);
});

test("matches visible cards plus the configured preload margin", () => {
  const viewport = { bottom: 500, top: 100 };

  assert.equal(
    isNearVerticalViewport({ bottom: 200, top: 150 }, viewport, 400),
    true,
  );
  assert.equal(
    isNearVerticalViewport({ bottom: 80, top: 20 }, viewport, 0),
    false,
  );
  assert.equal(
    isNearVerticalViewport({ bottom: 900, top: 850 }, viewport, 400),
    true,
  );
  assert.equal(
    isNearVerticalViewport({ bottom: 950, top: 901 }, viewport, 400),
    false,
  );
});

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("Timed out waiting for queued image tasks");
}
