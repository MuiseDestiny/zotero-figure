import * as assert from "node:assert/strict";
import test from "node:test";
import { AsyncPermitPool } from "../src/services/concurrency/asyncPermitPool";
import { OperationCancelledError } from "../src/utils/cancellation";

test("bounds active permits and dispatches queued waiters", async () => {
  const pool = new AsyncPermitPool(2);
  const releaseFirst = await pool.acquire();
  const releaseSecond = await pool.acquire();
  const third = pool.acquire();

  assert.equal(pool.activeCount, 2);
  assert.equal(pool.pendingCount, 1);
  releaseFirst();
  const releaseThird = await third;
  assert.equal(pool.activeCount, 2);
  assert.equal(pool.pendingCount, 0);

  releaseFirst();
  assert.equal(pool.activeCount, 2);
  releaseSecond();
  releaseThird();
  assert.equal(pool.activeCount, 0);
});

test("cancels a queued permit without consuming capacity", async () => {
  const pool = new AsyncPermitPool(1);
  const release = await pool.acquire();
  const controller = new AbortController();
  const queued = pool.acquire(controller.signal);

  controller.abort();
  await assert.rejects(queued, OperationCancelledError);
  assert.equal(pool.pendingCount, 0);
  assert.equal(pool.activeCount, 1);

  release();
  assert.equal(pool.activeCount, 0);
});

test("rejects invalid limits and already-cancelled requests", () => {
  assert.throws(() => new AsyncPermitPool(0), /positive integer/);
  const controller = new AbortController();
  controller.abort();
  assert.throws(
    () => new AsyncPermitPool(1).acquire(controller.signal),
    OperationCancelledError,
  );
});
