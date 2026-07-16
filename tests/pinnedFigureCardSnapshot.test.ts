import * as assert from "node:assert/strict";
import test from "node:test";
import {
  PinnedCardSnapshotSlot,
  type PinnedCardSnapshot,
} from "../src/features/reader/pinnedFigureCardView";

test("replaces a same-card snapshot and releases its superseded Blob URL", async () => {
  let displayed = "old";
  let oldReleases = 0;
  let nextReleases = 0;
  const slot = new PinnedCardSnapshotSlot(() => oldReleases++);

  const applied = await slot.refresh(async () => ({
    apply: () => {
      displayed = "new";
    },
    release: () => nextReleases++,
  }));

  assert.equal(applied, true);
  assert.equal(displayed, "new");
  assert.equal(oldReleases, 1);
  assert.equal(nextReleases, 0);

  slot.dispose();
  assert.equal(nextReleases, 1);
});

test("prevents an out-of-order refresh from replacing the latest snapshot", async () => {
  const first = createDeferred<PinnedCardSnapshot>();
  const second = createDeferred<PinnedCardSnapshot>();
  const applied: string[] = [];
  const released: string[] = [];
  const slot = new PinnedCardSnapshotSlot(() => released.push("initial"));

  const firstRefresh = slot.refresh(async () => first.promise);
  const secondRefresh = slot.refresh(async () => second.promise);
  second.resolve(createSnapshot("second", applied, released));
  assert.equal(await secondRefresh, true);

  first.resolve(createSnapshot("first", applied, released));
  assert.equal(await firstRefresh, false);

  assert.deepEqual(applied, ["second"]);
  assert.deepEqual(released, ["initial", "first"]);
  slot.dispose();
  assert.deepEqual(released, ["initial", "first", "second"]);
});

test("can retain the current snapshot when a pending target is superseded", async () => {
  const pending = createDeferred<PinnedCardSnapshot>();
  let cancelled = 0;
  let currentReleases = 0;
  let pendingReleases = 0;
  const slot = new PinnedCardSnapshotSlot(() => currentReleases++);
  const refresh = slot.refresh(async (registerCancellation) => {
    registerCancellation(() => cancelled++);
    return pending.promise;
  });

  slot.cancelPendingRefresh();
  pending.resolve({
    apply: () => assert.fail("the superseded target must not be applied"),
    release: () => pendingReleases++,
  });

  assert.equal(await refresh, false);
  assert.equal(cancelled, 1);
  assert.equal(pendingReleases, 1);
  assert.equal(currentReleases, 0);
  slot.dispose();
  assert.equal(currentReleases, 1);
});

test("keeps the usable snapshot when preparation or decoding fails", async () => {
  let currentReleases = 0;
  const slot = new PinnedCardSnapshotSlot(() => currentReleases++);

  await assert.rejects(
    slot.refresh(async () => {
      throw new Error("decode failed");
    }),
    /decode failed/,
  );

  assert.equal(currentReleases, 0);
  slot.dispose();
  assert.equal(currentReleases, 1);
});

test("cancels pending work and releases its late snapshot during cleanup", async () => {
  const pending = createDeferred<PinnedCardSnapshot>();
  let cancelled = 0;
  let currentReleases = 0;
  let pendingReleases = 0;
  const slot = new PinnedCardSnapshotSlot(() => currentReleases++);
  const refresh = slot.refresh(async (registerCancellation) => {
    registerCancellation(() => cancelled++);
    return pending.promise;
  });

  slot.dispose();
  assert.equal(cancelled, 1);
  assert.equal(currentReleases, 1);

  pending.resolve({
    apply: () => assert.fail("disposed cards cannot accept late snapshots"),
    release: () => pendingReleases++,
  });
  assert.equal(await refresh, false);
  assert.equal(pendingReleases, 1);

  slot.dispose();
  assert.equal(currentReleases, 1);
});

function createSnapshot(
  name: string,
  applied: string[],
  released: string[],
): PinnedCardSnapshot {
  return {
    apply: () => applied.push(name),
    release: () => released.push(name),
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
